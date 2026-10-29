/**
 * Posição financeira das obras.
 *
 * Definições (as mesmas que aparecem na tela):
 * - Custo apropriado: soma das apropriações de notas APROVADAS na obra.
 * - Realizado (pago): parte do custo apropriado cujos títulos já foram pagos.
 * - Comprometido (a pagar): parte do custo apropriado com títulos em aberto.
 * - % comprometido = (pago + a pagar) / orçamento.
 * Como uma nota pode ser rateada entre obras, pago/aberto de cada título é distribuído
 * proporcionalmente às apropriações daquela nota.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { Tx } from '../db/client.js'
import { allocations, documents, payables, projectBudgets, projects, type CostCategory } from '../db/schema.js'
import { splitProportional } from '../domain/money.js'

export interface ProjectFinancials {
  projectId: string
  budget: number
  appropriated: number
  paid: number
  open: number
  committedPct: number
  byCategory: Partial<Record<CostCategory, { budget: number; appropriated: number }>>
}

export async function computeProjectFinancials(tx: Tx, companyId: string, projectIds?: string[]): Promise<Map<string, ProjectFinancials>> {
  const projectRows = await tx
    .select({ id: projects.id, budget: projects.budgetTotal })
    .from(projects)
    .where(projectIds?.length ? and(eq(projects.companyId, companyId), inArray(projects.id, projectIds)) : eq(projects.companyId, companyId))

  const result = new Map<string, ProjectFinancials>()
  for (const p of projectRows) {
    result.set(p.id, { projectId: p.id, budget: p.budget, appropriated: 0, paid: 0, open: 0, committedPct: 0, byCategory: {} })
  }
  if (!projectRows.length) return result
  const ids = projectRows.map((p) => p.id)

  const budgets = await tx.select().from(projectBudgets).where(inArray(projectBudgets.projectId, ids))
  for (const b of budgets) {
    const f = result.get(b.projectId)!
    f.byCategory[b.category] = { budget: b.amount, appropriated: f.byCategory[b.category]?.appropriated ?? 0 }
  }

  const allocs = await tx
    .select({ documentId: allocations.documentId, projectId: allocations.projectId, category: allocations.category, amount: allocations.amount })
    .from(allocations)
    .innerJoin(documents, eq(documents.id, allocations.documentId))
    .where(and(eq(documents.companyId, companyId), eq(documents.status, 'APROVADO'), inArray(allocations.projectId, ids)))

  if (!allocs.length) return result

  // todas as apropriações dos documentos envolvidos (inclusive em obras fora do filtro, para o rateio)
  const docIds = [...new Set(allocs.map((a) => a.documentId))]
  const allAllocs = await tx
    .select({ documentId: allocations.documentId, projectId: allocations.projectId, amount: allocations.amount })
    .from(allocations)
    .where(inArray(allocations.documentId, docIds))
  const pays = await tx
    .select({ documentId: payables.documentId, amount: payables.amount, paidAmount: payables.paidAmount, status: payables.status })
    .from(payables)
    .where(inArray(payables.documentId, docIds))

  const docPaid = new Map<string, number>()
  const docOpen = new Map<string, number>()
  for (const p of pays) {
    if (p.status === 'CANCELADO') continue
    docPaid.set(p.documentId, (docPaid.get(p.documentId) ?? 0) + p.paidAmount)
    docOpen.set(p.documentId, (docOpen.get(p.documentId) ?? 0) + (p.amount - p.paidAmount))
  }

  for (const a of allocs) {
    const f = result.get(a.projectId)!
    f.appropriated += a.amount
    const cat = (f.byCategory[a.category] ??= { budget: 0, appropriated: 0 })
    cat.appropriated += a.amount
  }

  for (const docId of docIds) {
    const parts = allAllocs.filter((a) => a.documentId === docId)
    const weights = parts.map((p) => p.amount)
    const paidSplit = splitProportional(docPaid.get(docId) ?? 0, weights)
    const openSplit = splitProportional(docOpen.get(docId) ?? 0, weights)
    parts.forEach((p, i) => {
      const f = result.get(p.projectId)
      if (!f) return
      f.paid += paidSplit[i]
      f.open += openSplit[i]
    })
  }

  for (const f of result.values()) {
    f.committedPct = f.budget > 0 ? Math.round(((f.paid + f.open) / f.budget) * 1000) / 10 : 0
  }
  return result
}
