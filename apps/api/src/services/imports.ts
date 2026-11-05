/**
 * Importação de obras e orçamento por planilha (.xlsx ou .csv).
 *
 * Uma linha por obra: código, nome, endereço, situação, início, término,
 * orçamento por categoria e orçamento total (em branco = soma das categorias).
 * Código que já existe atualiza a obra; código novo cadastra.
 * Fluxo em dois passos: prévia (nada é gravado) e confirmação (só as linhas sem erro).
 */
import ExcelJS from 'exceljs'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { COST_CATEGORIES, projectBudgets, projects } from '../db/schema.js'
import { audit } from './audit.js'
import { categoryLabel } from './alerts.js'
import { badRequest } from './errors.js'

type Category = (typeof COST_CATEGORIES)[number]
type Status = 'ATIVA' | 'PAUSADA' | 'CONCLUIDA'

export interface ImportRow {
  line: number
  code: string
  name: string
  address: string | null
  status: Status
  startDate: string | null
  endDate: string | null
  budgets: Array<{ category: Category; amount: number }>
  budgetTotal: number
  /** NOVA = cadastra; ATUALIZA = obra com este código já existe */
  action: 'NOVA' | 'ATUALIZA' | null
  projectId: string | null
  errors: string[]
  warnings: string[]
}

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Cabeçalhos aceitos (sem acento, minúsculo). A planilha modelo usa o primeiro de cada lista. */
const FIELDS: Array<[string, string[]]> = [
  ['code', ['codigo', 'cod', 'codigo da obra']],
  ['name', ['nome da obra', 'nome', 'obra']],
  ['address', ['endereco', 'local']],
  ['status', ['situacao', 'status']],
  ['startDate', ['inicio', 'data de inicio', 'data inicio']],
  ['endDate', ['termino', 'fim', 'previsao de termino', 'data de termino']],
  ['MATERIAIS', ['materiais', 'material']],
  ['MAO_DE_OBRA', ['mao de obra']],
  ['TERCEIRIZADOS', ['terceirizados', 'terceirizado', 'empreiteiros']],
  ['EQUIPAMENTOS', ['equipamentos', 'equipamento']],
  ['SERVICOS', ['servicos', 'servico']],
  ['OUTROS', ['outros']],
  ['budgetTotal', ['orcamento total', 'total', 'orcamento']],
]
export const TEMPLATE_HEADERS = ['Código', 'Nome da obra', 'Endereço', 'Situação', 'Início', 'Término', ...COST_CATEGORIES.map(categoryLabel), 'Orçamento total']

const STATUS: Record<string, Status> = {
  '': 'ATIVA',
  ativa: 'ATIVA',
  ativo: 'ATIVA',
  'em andamento': 'ATIVA',
  andamento: 'ATIVA',
  pausada: 'PAUSADA',
  pausado: 'PAUSADA',
  parada: 'PAUSADA',
  concluida: 'CONCLUIDA',
  concluido: 'CONCLUIDA',
  finalizada: 'CONCLUIDA',
  entregue: 'CONCLUIDA',
}

// ------------------------------------------------------------------ leitura do arquivo

type Cell = string | number | Date | null

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue)
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('')
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text)
  }
  return String(v)
}

async function readXlsx(content: Buffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(content as unknown as ArrayBuffer)
  } catch {
    throw badRequest('PLANILHA_INVALIDA', 'Não consegui abrir a planilha. Salve como .xlsx ou .csv e tente de novo.')
  }
  // a aba "Obras" do modelo; senão, a primeira aba com dados
  const ws = wb.getWorksheet('Obras') ?? wb.worksheets.find((w) => w.actualRowCount > 0)
  if (!ws) return []
  const rows: Cell[][] = []
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals: Cell[] = []
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value))
    rows[n - 1] = vals
  })
  return Array.from(rows, (r) => r ?? [])
}

/** CSV com ";" (Excel brasileiro) ou "," (Google Planilhas), aspas e quebras de linha. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '')
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

function isXlsx(fileName: string, content: Buffer) {
  return content.subarray(0, 2).toString('latin1') === 'PK' || /\.xlsx$/i.test(fileName)
}

// ------------------------------------------------------------------ valores

/** "R$ 1.234.567,89", "1234567.89", 1234567.89 → centavos. null = vazio; NaN = inválido. */
export function parseMoney(v: Cell): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN
  if (v instanceof Date) return NaN
  let s = v.replace(/r\$|\s/gi, '').trim()
  if (!s || s === '-') return null
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/[()-]/g, '')
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (/\.\d{3}(\.|$)/.test(s) && !/,/.test(s)) s = s.replace(/\./g, '') // 1.234.567
  else s = s.replace(/,/g, '') // 1,234.56
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN
  const n = Math.round(Number(s) * 100)
  return neg ? -n : n
}

/** dd/mm/aaaa, aaaa-mm-dd, data do Excel → "aaaa-mm-dd". null = vazio; "" = inválido. */
export function parseDate(v: Cell): string | null {
  if (v == null || v === '') return null
  const iso = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return ''
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  if (v instanceof Date) return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  if (typeof v === 'number') {
    // número de série do Excel (dias desde 30/12/1899)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const s = v.trim()
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]))
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s) // mm/aaaa
  if (m) return iso(Number(m[2]), Number(m[1]), 1)
  return ''
}

const text = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim()

// ------------------------------------------------------------------ prévia

export async function previewImport(companyId: string, file: { fileName: string; content: Buffer }, allowedProjectIds: string[] | null) {
  const grid: Cell[][] = isXlsx(file.fileName, file.content) ? await readXlsx(file.content) : parseCsv(file.content.toString('utf8'))

  // a linha de cabeçalho é a primeira (até a 10ª) que tem "código" e "nome"
  let headerAt = -1
  let map = new Map<string, number>()
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const m = new Map<string, number>()
    ;(grid[i] ?? []).forEach((h, col) => {
      const key = norm(h)
      const f = FIELDS.find(([, names]) => names.includes(key))
      if (f && !m.has(f[0])) m.set(f[0], col)
    })
    if (m.has('code') && m.has('name')) {
      headerAt = i
      map = m
      break
    }
  }
  if (headerAt < 0) throw badRequest('PLANILHA_INVALIDA', 'Não achei as colunas "Código" e "Nome da obra". Use a planilha modelo.')

  const existing = await db.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.companyId, companyId))
  const byCode = new Map(existing.map((p) => [p.code.toUpperCase(), p.id]))
  const seen = new Map<string, number>()
  const get = (r: Cell[], f: string) => (map.has(f) ? (r[map.get(f)!] ?? null) : null)

  const rows: ImportRow[] = []
  for (let i = headerAt + 1; i < grid.length; i++) {
    const r = grid[i] ?? []
    if (r.every((c) => text(c) === '')) continue
    const line = i + 1
    const errors: string[] = []
    const warnings: string[] = []
    const code = text(get(r, 'code')).toUpperCase()
    const name = text(get(r, 'name'))
    if (!code) errors.push('Código em branco')
    else if (code.length > 30) errors.push('Código com mais de 30 caracteres')
    if (name.length < 2) errors.push('Nome da obra em branco')
    if (code && seen.has(code)) errors.push(`Código repetido (também na linha ${seen.get(code)})`)
    if (code) seen.set(code, line)

    const statusText = norm(get(r, 'status'))
    const status = STATUS[statusText]
    if (!status) errors.push(`Situação "${text(get(r, 'status'))}" não reconhecida (use Ativa, Pausada ou Concluída)`)

    const dates: Record<'startDate' | 'endDate', string | null> = { startDate: null, endDate: null }
    for (const [f, label] of [
      ['startDate', 'Início'],
      ['endDate', 'Término'],
    ] as const) {
      const d = parseDate(get(r, f))
      if (d === '') errors.push(`${label} "${text(get(r, f))}" não é uma data (use dd/mm/aaaa)`)
      else dates[f] = d
    }
    if (dates.startDate && dates.endDate && dates.endDate < dates.startDate) errors.push('Término antes do início')

    const budgets: ImportRow['budgets'] = []
    for (const cat of COST_CATEGORIES) {
      const v = parseMoney(get(r, cat))
      if (v == null) continue
      if (Number.isNaN(v)) errors.push(`${categoryLabel(cat)}: "${text(get(r, cat))}" não é um valor`)
      else if (v < 0) errors.push(`${categoryLabel(cat)} negativo`)
      else if (v > 0) budgets.push({ category: cat, amount: v })
    }
    const sum = budgets.reduce((a, b) => a + b.amount, 0)
    const totalRaw = parseMoney(get(r, 'budgetTotal'))
    let budgetTotal = sum
    if (totalRaw != null) {
      if (Number.isNaN(totalRaw)) errors.push(`Orçamento total: "${text(get(r, 'budgetTotal'))}" não é um valor`)
      else if (totalRaw < 0) errors.push('Orçamento total negativo')
      else {
        budgetTotal = totalRaw
        if (budgets.length && totalRaw < sum) errors.push('Orçamento total menor que a soma das categorias')
        else if (budgets.length && totalRaw > sum) warnings.push('Parte do orçamento total não está em nenhuma categoria')
      }
    }
    if (!budgetTotal && !errors.some((e) => e.startsWith('Orçamento'))) errors.push('Sem orçamento (preencha o total ou as categorias)')

    const projectId = code ? (byCode.get(code) ?? null) : null
    if (projectId && allowedProjectIds && !allowedProjectIds.includes(projectId)) errors.push('Esta obra não está liberada para você')
    if (projectId && !budgets.length) warnings.push('Sem categorias: o orçamento por categoria atual da obra fica como está')

    rows.push({
      line,
      code,
      name,
      address: text(get(r, 'address')) || null,
      status: status ?? 'ATIVA',
      startDate: dates.startDate,
      endDate: dates.endDate,
      budgets,
      budgetTotal,
      action: errors.length ? null : projectId ? 'ATUALIZA' : 'NOVA',
      projectId,
      errors,
      warnings,
    })
  }
  if (!rows.length) throw badRequest('PLANILHA_INVALIDA', 'A planilha não tem nenhuma obra abaixo do cabeçalho.')
  if (rows.length > 500) throw badRequest('PLANILHA_INVALIDA', 'Importe no máximo 500 obras por vez.')

  return {
    fileName: file.fileName,
    rows,
    summary: {
      total: rows.length,
      create: rows.filter((r) => r.action === 'NOVA').length,
      update: rows.filter((r) => r.action === 'ATUALIZA').length,
      errors: rows.filter((r) => r.errors.length).length,
    },
    columnsMissing: FIELDS.filter(([f]) => !map.has(f) && f !== 'budgetTotal' && !COST_CATEGORIES.includes(f as Category)).map(([, n]) => n[0]),
  }
}

// ------------------------------------------------------------------ confirmação

/**
 * Grava as linhas sem erro, tudo ou nada. Refaz a prévia a partir do mesmo arquivo,
 * para não confiar em dados editados no navegador.
 */
export async function confirmImport(
  companyId: string,
  userId: string,
  file: { fileName: string; content: Buffer },
  allowedProjectIds: string[] | null,
) {
  const preview = await previewImport(companyId, file, allowedProjectIds)
  const ok = preview.rows.filter((r) => r.action)
  if (!ok.length) throw badRequest('PLANILHA_INVALIDA', 'Nenhuma linha sem erro para importar.')
  const result = await db.transaction(async (tx) => {
    let created = 0
    let updated = 0
    for (const r of ok) {
      const values = {
        name: r.name,
        address: r.address,
        status: r.status,
        startDate: r.startDate ? new Date(r.startDate) : null,
        endDate: r.endDate ? new Date(r.endDate) : null,
        budgetTotal: r.budgetTotal,
      }
      let id = r.projectId
      if (id) {
        await tx
          .update(projects)
          .set(values)
          .where(and(eq(projects.companyId, companyId), eq(projects.id, id)))
        if (r.budgets.length) await tx.delete(projectBudgets).where(eq(projectBudgets.projectId, id))
        updated++
      } else {
        const [p] = await tx
          .insert(projects)
          .values({ companyId, code: r.code, ...values })
          .returning({ id: projects.id })
        id = p.id
        created++
      }
      if (r.budgets.length) await tx.insert(projectBudgets).values(r.budgets.map((b) => ({ projectId: id!, ...b })))
      await audit(tx, { companyId, userId, entity: 'project', entityId: id!, action: r.projectId ? 'imported_update' : 'imported', data: { file: file.fileName, line: r.line, ...values, budgets: r.budgets } })
    }
    return { created, updated }
  })
  return { ...result, skipped: preview.rows.length - ok.length }
}

// ------------------------------------------------------------------ planilha modelo

export async function importTemplate(companyId: string) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'OperaIA Obras'
  const ws = wb.addWorksheet('Obras', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = TEMPLATE_HEADERS.map((h, i) => ({
    header: h,
    width: i === 1 ? 32 : i === 2 ? 36 : i < 6 ? 13 : 16,
    style: i >= 6 ? { numFmt: '#,##0.00' } : i === 4 || i === 5 ? { numFmt: 'dd/mm/yyyy' } : {},
  }))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3B30' } }
  head.alignment = { vertical: 'middle' }
  head.height = 22

  // exemplos: as obras já cadastradas (para atualizar) ou duas obras fictícias
  const current = await db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(projects.code)
  const budgets = current.length
    ? await db.select().from(projectBudgets).where(inArray(projectBudgets.projectId, current.map((p) => p.id)))
    : []
  const label = { ATIVA: 'Ativa', PAUSADA: 'Pausada', CONCLUIDA: 'Concluída' } as const
  const rows = current.length
    ? current.map((p) => [
        p.code,
        p.name,
        p.address ?? '',
        label[p.status],
        p.startDate ?? null,
        p.endDate ?? null,
        ...COST_CATEGORIES.map((c) => {
          const b = budgets.find((x) => x.projectId === p.id && x.category === c)
          return b ? b.amount / 100 : null
        }),
        p.budgetTotal / 100,
      ])
    : [
        ['OBR-001', 'Residencial Exemplo', 'Rua das Flores, 100 - São Carlos/SP', 'Ativa', new Date(Date.UTC(2026, 0, 15)), new Date(Date.UTC(2027, 5, 30)), 1200000, 800000, 350000, 120000, 80000, 50000, null],
        ['OBR-002', 'Reforma Loja Centro', 'Av. São Carlos, 2000', 'Ativa', new Date(Date.UTC(2026, 2, 1)), null, null, null, null, null, null, null, 450000],
      ]
  for (const r of rows) ws.addRow(r)
  // lista de situações sem criar linhas vazias (assim o Excel continua a partir da última obra)
  ;(ws as unknown as { dataValidations: { add: (range: string, v: ExcelJS.DataValidation) => void } }).dataValidations.add('D2:D1000', {
    type: 'list',
    allowBlank: true,
    formulae: ['"Ativa,Pausada,Concluída"'],
  })

  const help = wb.addWorksheet('Como preencher')
  help.getColumn(1).width = 110
  ;[
    'Como preencher a planilha de obras',
    '',
    '• Uma linha por obra. Não mude os nomes das colunas da aba "Obras".',
    '• Código: o mesmo que aparece na nota fiscal ("Obra: OBR-005"). Código que já existe ATUALIZA a obra; código novo CADASTRA.',
    '• Situação: Ativa, Pausada ou Concluída (em branco = Ativa).',
    '• Início e Término: dd/mm/aaaa (podem ficar em branco).',
    '• Categorias (Materiais, Mão de obra…): valor orçado em reais. Deixe em branco o que não tiver.',
    '• Orçamento total: em branco = soma das categorias. Pode ser maior que a soma (reserva), nunca menor.',
    '• Ao atualizar uma obra sem preencher categorias, o orçamento por categoria que já está no sistema fica como está.',
    '• Também aceitamos .csv (separado por ; ou ,) com as mesmas colunas.',
    '',
    'Antes de gravar, o sistema mostra uma prévia com o que vai ser cadastrado, atualizado e as linhas com erro.',
  ].forEach((t, i) => {
    const c = help.getCell(i + 1, 1)
    c.value = t
    if (i === 0) c.font = { bold: true, size: 14 }
  })
  return Buffer.from(await wb.xlsx.writeBuffer())
}
