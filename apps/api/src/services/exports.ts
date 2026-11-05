/**
 * Exportações em CSV no padrão que o Excel brasileiro abre direto:
 * separador ";", decimal com vírgula, datas dd/mm/aaaa e BOM UTF-8.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { zipSync, type Zippable } from 'fflate'
import { db } from '../db/client.js'
import { allocations, documents, projects, suppliers } from '../db/schema.js'
import { formatCnpj } from '../domain/cnpj.js'
import { categoryLabel } from './alerts.js'
import { listPayables } from './documents.js'
import { badRequest } from './errors.js'
import { allocInScope, docInScope, type Scope } from './scope.js'
import { storage } from './storage.js'

const BOM = '﻿'
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')
const dateBR = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''
/** CNPJ com máscara e chave de acesso em blocos de 4 (como no DANFE): o Excel mantém como texto. */
const fmtCnpj = (v: string | null) => (v ? formatCnpj(v) : '')
// chave interna da NFS-e municipal (NFSE-<município>-<prestador>-<número>) não é chave fiscal: fica em branco
const fmtKey = (v: string | null) => (v && !v.startsWith('NFSE-') ? v.replace(/([0-9A-Z]{4})(?=[0-9A-Z])/g, '$1 ') : '')
const dateISO = (d: Date | null) => (d ? d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : 'sem-data')
const toCsv = (header: string[], rows: unknown[][]) => BOM + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'

const STATUS: Record<string, string> = { ABERTO: 'Em aberto', PARCIAL: 'Parcial', PAGO: 'Pago', CANCELADO: 'Cancelado' }

export async function exportPayables(companyId: string, filters: { status?: string; from?: string; to?: string; projectId?: string; scope?: Scope }) {
  const rows = await listPayables(companyId, filters)
  return toCsv(
    ['Vencimento', 'Fornecedor', 'NF', 'Parcela', 'Descrição', 'Obra(s)', 'Valor', 'Pago', 'Em aberto', 'Situação'],
    rows.map((r) => [
      dateBR(r.dueDate),
      r.supplierName,
      r.documentNumber,
      r.installment,
      r.description,
      r.projectNames,
      money(r.amount),
      money(r.paidAmount),
      money(r.amount - r.paidAmount),
      STATUS[r.status] ?? r.status,
    ]),
  )
}

/** Lançamentos de custo por obra (uma linha por apropriação), filtrados pela data de emissão da nota. */
export async function exportAllocations(companyId: string, filters: { from?: string; to?: string; projectId?: string; scope?: Scope }) {
  const where = [eq(documents.companyId, companyId), eq(documents.status, 'APROVADO')]
  const inScope = allocInScope(filters.scope)
  if (inScope) where.push(inScope)
  if (filters.from) where.push(gte(documents.issueDate, new Date(`${filters.from}T00:00:00-03:00`)))
  if (filters.to) where.push(lte(documents.issueDate, new Date(`${filters.to}T23:59:59-03:00`)))
  if (filters.projectId) where.push(eq(allocations.projectId, filters.projectId))
  const rows = await db
    .select({
      issueDate: documents.issueDate,
      number: documents.number,
      accessKey: documents.accessKey,
      supplierName: suppliers.name,
      supplierCnpj: suppliers.cnpj,
      description: documents.description,
      projectCode: projects.code,
      projectName: projects.name,
      category: allocations.category,
      amount: allocations.amount,
      documentTotal: documents.totalAmount,
      approvedAt: documents.approvedAt,
    })
    .from(allocations)
    .innerJoin(documents, eq(documents.id, allocations.documentId))
    .innerJoin(projects, eq(projects.id, allocations.projectId))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(and(...where))
    .orderBy(documents.issueDate, sql`${documents.number}`)
  return toCsv(
    ['Emissão', 'NF', 'Fornecedor', 'CNPJ fornecedor', 'Descrição', 'Código obra', 'Obra', 'Categoria', 'Valor apropriado', 'Valor total da NF', 'Aprovada em', 'Chave de acesso'],
    rows.map((r) => [
      dateBR(r.issueDate),
      r.number,
      r.supplierName,
      fmtCnpj(r.supplierCnpj),
      r.description,
      r.projectCode,
      r.projectName,
      categoryLabel(r.category),
      money(r.amount),
      money(r.documentTotal ?? 0),
      dateBR(r.approvedAt),
      fmtKey(r.accessKey),
    ]),
  )
}

// ------------------------------------------------------------------ pacote do contador

const slug = (s: string | null | undefined, max = 40) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'sem-nome'

const MAX_DOCS = 3000
const MAX_BYTES = 400 * 1024 * 1024

/**
 * ZIP com as notas aprovadas no período (pela data de emissão) para o contador:
 * XML/ (NF-e originais), PDF e fotos/ (recibos, NFS-e em PDF, fotos), notas.csv (índice)
 * e lancamentos-por-obra.csv (custo apropriado). Respeita as obras liberadas da pessoa.
 */
export async function exportAccountantZip(companyId: string, filters: { from: string; to: string; scope?: Scope }) {
  const where = [
    eq(documents.companyId, companyId),
    eq(documents.status, 'APROVADO'),
    gte(documents.issueDate, new Date(`${filters.from}T00:00:00-03:00`)),
    lte(documents.issueDate, new Date(`${filters.to}T23:59:59-03:00`)),
  ]
  const inScope = docInScope(documents.id, filters.scope)
  if (inScope) where.push(inScope)
  const docs = await db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      series: documents.series,
      issueDate: documents.issueDate,
      totalAmount: documents.totalAmount,
      accessKey: documents.accessKey,
      description: documents.description,
      fileName: documents.fileName,
      filePath: documents.filePath,
      approvedAt: documents.approvedAt,
      supplierName: sql<string | null>`coalesce(${suppliers.tradeName}, ${suppliers.name})`,
      supplierCnpj: suppliers.cnpj,
      projects: sql<string | null>`(SELECT string_agg(DISTINCT p.code || ' ' || p.name, ', ') FROM allocations a JOIN projects p ON p.id = a.project_id WHERE a.document_id = ${documents.id})`,
      categories: sql<string[] | null>`(SELECT array_agg(DISTINCT a.category::text) FROM allocations a WHERE a.document_id = ${documents.id})`,
      orderNumber: sql<number | null>`(SELECT po.number FROM purchase_orders po WHERE po.id = ${documents.purchaseOrderId})`,
      /** NFS-e: retenções, líquido e chave nacional */
      nfse: sql<{ retentions: Record<string, number>; netCents: number; nationalKey: string | null } | null>`${documents.raw}->'nfse'`,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(and(...where))
    .orderBy(documents.issueDate, sql`${documents.number}`)
    .limit(MAX_DOCS + 1)
  if (docs.length > MAX_DOCS) throw badRequest('PERIODO_GRANDE', `Mais de ${MAX_DOCS} notas no período. Baixe um mês por vez.`)

  const files: Zippable = {}
  const used = new Set<string>()
  const unique = (p: string) => {
    let name = p
    for (let i = 2; used.has(name); i++) name = p.replace(/(\.[^.]+)?$/, (ext) => `-${i}${ext}`)
    used.add(name)
    return name
  }
  let bytes = 0
  let retainedTotal = 0
  const index: unknown[][] = []
  for (const d of docs) {
    const ext = (d.fileName?.match(/\.[A-Za-z0-9]{2,5}$/)?.[0] ?? '').toLowerCase()
    const isXml = ext === '.xml'
    let saved = ''
    // arquivo que sumiu continua no índice como "não guardado"; falha do armazenamento interrompe o pacote
    const content = d.filePath ? await storage().get(d.filePath) : null
    if (content) {
      bytes += content.length
      if (bytes > MAX_BYTES) throw badRequest('PACOTE_GRANDE', 'O pacote passou de 400 MB. Baixe um período menor.')
      const base = `${dateISO(d.issueDate)}_${d.type === 'NFSE' ? 'NFSe' : 'NF'}-${slug(d.number, 15)}_${slug(d.supplierName, 30)}`
      saved = unique(`${isXml ? 'XML' : 'PDF e fotos'}/${base}${ext || '.bin'}`)
      files[saved] = [new Uint8Array(content), { level: isXml ? 6 : 0, mtime: d.issueDate ?? new Date() }]
    }
    const r = d.nfse?.retentions ?? {}
    const ret = (k: string) => (d.nfse ? money(r[k] ?? 0) : '')
    const fedOthers = (r.pis ?? 0) + (r.cofins ?? 0) + (r.csll ?? 0) + (r.outras ?? 0)
    retainedTotal += d.nfse ? (r.iss ?? 0) + (r.inss ?? 0) + (r.ir ?? 0) + fedOthers : 0
    index.push([
      dateBR(d.issueDate),
      d.type === 'NFE' ? 'NF-e' : d.type === 'NFSE' ? 'NFS-e' : d.type === 'RECIBO' ? 'Recibo' : 'Outro',
      d.number,
      d.series,
      d.supplierName,
      fmtCnpj(d.supplierCnpj),
      money(d.totalAmount ?? 0),
      ret('iss'),
      ret('inss'),
      ret('ir'),
      d.nfse ? money(fedOthers) : '',
      money(d.nfse ? d.nfse.netCents : (d.totalAmount ?? 0)),
      d.projects,
      (d.categories ?? []).map(categoryLabel).join(', '),
      d.orderNumber ? `PC-${String(d.orderNumber).padStart(4, '0')}` : '',
      d.description,
      dateBR(d.approvedAt),
      saved || 'arquivo original não guardado',
      d.type === 'NFSE' ? fmtKey(d.nfse?.nationalKey ?? null) : fmtKey(d.accessKey),
    ])
  }
  const enc = new TextEncoder()
  files['notas.csv'] = enc.encode(
    toCsv(['Emissão', 'Tipo', 'Número', 'Série', 'Fornecedor', 'CNPJ fornecedor', 'Valor', 'ISS retido', 'INSS retido', 'IR retido', 'PIS/COFINS/CSLL retidos', 'Valor líquido pago', 'Obra(s)', 'Categoria(s)', 'Pedido', 'Descrição', 'Aprovada em', 'Arquivo no pacote', 'Chave de acesso'], index),
  )
  files['lancamentos-por-obra.csv'] = enc.encode(await exportAllocations(companyId, filters))
  const total = docs.reduce((a, d) => a + (d.totalAmount ?? 0), 0)
  files['LEIA-ME.txt'] = enc.encode(
    [
      'OperaIA Obras — notas aprovadas para a contabilidade',
      `Período (data de emissão): ${dateBR(new Date(`${filters.from}T12:00:00-03:00`))} a ${dateBR(new Date(`${filters.to}T12:00:00-03:00`))}`,
      `Notas: ${docs.length} · Valor total: ${(total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
      ...(retainedTotal ? [`Retenções nas NFS-e (a construtora recolhe em guia): ${(retainedTotal / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} — detalhe por nota em notas.csv`] : []),
      `Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      '',
      'XML/            arquivos XML originais das NF-e e NFS-e',
      'PDF e fotos/    recibos, notas em PDF e fotos enviadas',
      'notas.csv       uma linha por nota (abre no Excel)',
      'lancamentos-por-obra.csv   custo apropriado por obra e categoria',
      '',
    ].join('\r\n'),
  )
  return { zip: Buffer.from(zipSync(files, { level: 6 })), count: docs.length }
}
