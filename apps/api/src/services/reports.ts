/**
 * Relatórios de custo: por obra, por fornecedor e por mês.
 * Base: apropriações de notas APROVADAS, pela data de emissão da nota (fuso de São Paulo).
 * Os mesmos números alimentam a tela e as planilhas.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { COST_CATEGORIES, allocations, documents, projects, suppliers, type CostCategory } from '../db/schema.js'
import { categoryLabel } from './alerts.js'

type ByCat = Partial<Record<CostCategory, number>>

export interface ReportData {
  from: string | null
  to: string | null
  total: number
  documents: number
  byCategory: ByCat
  byProject: { projectId: string; code: string; name: string; budget: number; total: number; documents: number; byCategory: ByCat }[]
  bySupplier: { supplierId: string | null; name: string; cnpj: string | null; total: number; documents: number; mainCategory: CostCategory | null; byProject: Record<string, number> }[]
  byMonth: { month: string; total: number; documents: number; byCategory: ByCat }[]
}

export async function getReports(companyId: string, from?: string, to?: string): Promise<ReportData> {
  const where = [eq(documents.companyId, companyId), eq(documents.status, 'APROVADO')]
  if (from) where.push(gte(documents.issueDate, new Date(`${from}T00:00:00-03:00`)))
  if (to) where.push(lte(documents.issueDate, new Date(`${to}T23:59:59-03:00`)))

  const rows = await db
    .select({
      documentId: documents.id,
      month: sql<string>`to_char(${documents.issueDate} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      budget: projects.budgetTotal,
      supplierId: suppliers.id,
      supplierName: sql<string | null>`coalesce(${suppliers.tradeName}, ${suppliers.name})`,
      supplierCnpj: suppliers.cnpj,
      category: allocations.category,
      amount: allocations.amount,
    })
    .from(allocations)
    .innerJoin(documents, eq(documents.id, allocations.documentId))
    .innerJoin(projects, eq(projects.id, allocations.projectId))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(and(...where))

  const out: ReportData = { from: from ?? null, to: to ?? null, total: 0, documents: 0, byCategory: {}, byProject: [], bySupplier: [], byMonth: [] }
  const allDocs = new Set<string>()
  const proj = new Map<string, ReportData['byProject'][number] & { docs: Set<string> }>()
  const supp = new Map<string, ReportData['bySupplier'][number] & { docs: Set<string>; cats: ByCat }>()
  const month = new Map<string, ReportData['byMonth'][number] & { docs: Set<string> }>()
  const add = (m: ByCat, c: CostCategory, v: number) => (m[c] = (m[c] ?? 0) + v)

  for (const r of rows) {
    out.total += r.amount
    allDocs.add(r.documentId)
    add(out.byCategory, r.category, r.amount)

    const p = proj.get(r.projectId) ?? { projectId: r.projectId, code: r.projectCode, name: r.projectName, budget: r.budget, total: 0, documents: 0, byCategory: {}, docs: new Set() }
    p.total += r.amount
    p.docs.add(r.documentId)
    add(p.byCategory, r.category, r.amount)
    proj.set(r.projectId, p)

    const sKey = r.supplierId ?? 'sem-fornecedor'
    const s = supp.get(sKey) ?? { supplierId: r.supplierId, name: r.supplierName ?? 'Sem fornecedor', cnpj: r.supplierCnpj, total: 0, documents: 0, mainCategory: null, byProject: {}, docs: new Set(), cats: {} }
    s.total += r.amount
    s.docs.add(r.documentId)
    add(s.cats, r.category, r.amount)
    s.byProject[r.projectId] = (s.byProject[r.projectId] ?? 0) + r.amount
    supp.set(sKey, s)

    const m = month.get(r.month) ?? { month: r.month, total: 0, documents: 0, byCategory: {}, docs: new Set() }
    m.total += r.amount
    m.docs.add(r.documentId)
    add(m.byCategory, r.category, r.amount)
    month.set(r.month, m)
  }

  out.documents = allDocs.size
  out.byProject = [...proj.values()].map(({ docs, ...p }) => ({ ...p, documents: docs.size })).sort((a, b) => b.total - a.total)
  out.bySupplier = [...supp.values()]
    .map(({ docs, cats, ...s }) => ({
      ...s,
      documents: docs.size,
      mainCategory: (Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] as CostCategory | undefined) ?? null,
    }))
    .sort((a, b) => b.total - a.total)
  out.byMonth = [...month.values()].map(({ docs, ...m }) => ({ ...m, documents: docs.size })).sort((a, b) => a.month.localeCompare(b.month))
  return out
}

// ------------------------------------------------------------------ CSV
const BOM = '﻿'
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')
const pctCell = (part: number, whole: number) => (whole ? ((part / whole) * 100).toFixed(1).replace('.', ',') : '')
const toCsv = (header: string[], rows: unknown[][]) => BOM + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`

export type ReportKind = 'obras' | 'fornecedores' | 'meses'

export async function exportReport(companyId: string, kind: ReportKind, from?: string, to?: string) {
  const r = await getReports(companyId, from, to)
  const cats = COST_CATEGORIES.filter((c) => r.byCategory[c])
  if (kind === 'obras') {
    return toCsv(
      ['Código', 'Obra', 'Notas', ...cats.map(categoryLabel), 'Total no período', '% do total', 'Orçamento da obra'],
      [
        ...r.byProject.map((p) => [p.code, p.name, p.documents, ...cats.map((c) => money(p.byCategory[c] ?? 0)), money(p.total), pctCell(p.total, r.total), money(p.budget)]),
        ['', 'Total', r.documents, ...cats.map((c) => money(r.byCategory[c] ?? 0)), money(r.total), '100,0', ''],
      ],
    )
  }
  if (kind === 'fornecedores') {
    return toCsv(
      ['Fornecedor', 'CNPJ', 'Categoria principal', 'Notas', 'Total no período', '% do total'],
      r.bySupplier.map((s) => [s.name, s.cnpj, s.mainCategory ? categoryLabel(s.mainCategory) : '', s.documents, money(s.total), pctCell(s.total, r.total)]),
    )
  }
  return toCsv(
    ['Mês', 'Notas', ...cats.map(categoryLabel), 'Total'],
    r.byMonth.map((m) => [monthLabel(m.month), m.documents, ...cats.map((c) => money(m.byCategory[c] ?? 0)), money(m.total)]),
  )
}
