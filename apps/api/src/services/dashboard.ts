import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { alerts, allocations, documents, payables, projects, suppliers } from '../db/schema.js'
import { evaluateDueAlerts } from './alerts.js'
import { computeProjectFinancials } from './financials.js'

/** Período no fuso de São Paulo: from/to como AAAA-MM-DD (inclusive). */
export function periodBounds(from?: string, to?: string) {
  const now = new Date()
  const ym = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
  const f = from ?? `${ym}-01`
  const lastDay = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()
  const t = to ?? `${ym}-${String(lastDay).padStart(2, '0')}`
  const start = new Date(`${f}T00:00:00-03:00`)
  const end = new Date(`${t}T23:59:59.999-03:00`)
  const span = end.getTime() - start.getTime()
  return { from: f, to: t, start, end, prevStart: new Date(start.getTime() - span - 1), prevEnd: new Date(start.getTime() - 1) }
}

async function appropriatedBetween(companyId: string, start: Date, end: Date) {
  const rows = await db
    .select({ category: allocations.category, total: sql<string>`sum(${allocations.amount})` })
    .from(allocations)
    .innerJoin(documents, eq(documents.id, allocations.documentId))
    .where(and(eq(documents.companyId, companyId), eq(documents.status, 'APROVADO'), gte(documents.issueDate, start), lte(documents.issueDate, end)))
    .groupBy(allocations.category)
  return rows.map((r) => ({ category: r.category, total: Number(r.total) }))
}

export async function getDashboard(companyId: string, from?: string, to?: string) {
  const period = periodBounds(from, to)
  await db.transaction((tx) => evaluateDueAlerts(tx, companyId))

  const [byCategory, prevByCategory, projectRows, openPayables, upcoming, openAlerts, pendingDocs] = await Promise.all([
    appropriatedBetween(companyId, period.start, period.end),
    appropriatedBetween(companyId, period.prevStart, period.prevEnd),
    db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(projects.code),
    db
      .select({ total: sql<string>`coalesce(sum(${payables.amount} - ${payables.paidAmount}), 0)` })
      .from(payables)
      .where(and(eq(payables.companyId, companyId), inArray(payables.status, ['ABERTO', 'PARCIAL']))),
    db
      .select({
        id: payables.id,
        dueDate: payables.dueDate,
        amount: payables.amount,
        paidAmount: payables.paidAmount,
        status: payables.status,
        installment: payables.installment,
        supplierName: suppliers.name,
        description: documents.description,
        documentNumber: documents.number,
        projectNames: sql<string | null>`(SELECT string_agg(DISTINCT p.name, ', ') FROM allocations a JOIN projects p ON p.id = a.project_id WHERE a.document_id = ${payables.documentId})`,
      })
      .from(payables)
      .innerJoin(documents, eq(documents.id, payables.documentId))
      .leftJoin(suppliers, eq(suppliers.id, payables.supplierId))
      .where(
        and(
          eq(payables.companyId, companyId),
          inArray(payables.status, ['ABERTO', 'PARCIAL']),
          lt(payables.dueDate, new Date(Date.now() + 30 * 86400000)),
        ),
      )
      .orderBy(payables.dueDate)
      .limit(8),
    db
      .select()
      .from(alerts)
      .where(and(eq(alerts.companyId, companyId), eq(alerts.status, 'ABERTO')))
      .orderBy(sql`case ${alerts.severity} when 'CRITICO' then 0 when 'ATENCAO' then 1 when 'OPORTUNIDADE' then 2 else 3 end`, desc(alerts.createdAt)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(eq(documents.companyId, companyId), inArray(documents.status, ['RECEBIDO', 'EM_REVISAO']))),
  ])

  const fin = await computeProjectFinancials(db, companyId)
  const active = projectRows.filter((p) => p.status === 'ATIVA')
  const cost = byCategory.reduce((a, b) => a + b.total, 0)
  const prevCost = prevByCategory.reduce((a, b) => a + b.total, 0)
  const budgetTotal = active.reduce((a, b) => a + b.budgetTotal, 0)
  const committedTotal = active.reduce((a, p) => a + (fin.get(p.id)?.paid ?? 0) + (fin.get(p.id)?.open ?? 0), 0)
  const newThisPeriod = projectRows.filter((p) => p.createdAt >= period.start && p.createdAt <= period.end).length

  return {
    period: { from: period.from, to: period.to },
    kpis: {
      appropriatedCost: cost,
      appropriatedCostChangePct: prevCost > 0 ? Math.round(((cost - prevCost) / prevCost) * 1000) / 10 : null,
      openPayables: Number(openPayables[0]?.total ?? 0),
      budgetTotal,
      budgetCommittedPct: budgetTotal > 0 ? Math.round((committedTotal / budgetTotal) * 1000) / 10 : 0,
      activeProjects: active.length,
      newProjectsThisPeriod: newThisPeriod,
      openAlerts: openAlerts.length,
      criticalAlerts: openAlerts.filter((a) => a.severity === 'CRITICO').length,
      documentsPending: pendingDocs[0]?.total ?? 0,
    },
    projects: active.map((p) => {
      const f = fin.get(p.id)!
      return { id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl, budget: p.budgetTotal, paid: f.paid, open: f.open, committedPct: f.committedPct }
    }),
    costsByCategory: byCategory.sort((a, b) => b.total - a.total),
    upcomingPayables: upcoming,
    alerts: openAlerts.slice(0, 6),
  }
}
