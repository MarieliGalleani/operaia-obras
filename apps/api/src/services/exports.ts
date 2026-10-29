/**
 * Exportações em CSV no padrão que o Excel brasileiro abre direto:
 * separador ";", decimal com vírgula, datas dd/mm/aaaa e BOM UTF-8.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { allocations, documents, projects, suppliers } from '../db/schema.js'
import { categoryLabel } from './alerts.js'
import { listPayables } from './documents.js'

const BOM = '﻿'
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')
const dateBR = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''
const toCsv = (header: string[], rows: unknown[][]) => BOM + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n'

const STATUS: Record<string, string> = { ABERTO: 'Em aberto', PARCIAL: 'Parcial', PAGO: 'Pago', CANCELADO: 'Cancelado' }

export async function exportPayables(companyId: string, filters: { status?: string; from?: string; to?: string; projectId?: string }) {
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
export async function exportAllocations(companyId: string, filters: { from?: string; to?: string; projectId?: string }) {
  const where = [eq(documents.companyId, companyId), eq(documents.status, 'APROVADO')]
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
      r.supplierCnpj,
      r.description,
      r.projectCode,
      r.projectName,
      categoryLabel(r.category),
      money(r.amount),
      money(r.documentTotal ?? 0),
      dateBR(r.approvedAt),
      r.accessKey,
    ]),
  )
}
