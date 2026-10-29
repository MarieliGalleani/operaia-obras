/**
 * Inteligência operacional — fase 1: regras determinísticas e explicáveis.
 * Cada alerta tem um "fingerprint" do fato que o gerou, para não duplicar.
 */
import { and, eq, gte, inArray, like, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import type { Tx } from '../db/client.js'
import { alerts, documentItems, documents, payables, projects, suppliers } from '../db/schema.js'
import { normalize } from '../domain/classifier.js'
import { formatBRL } from '../domain/money.js'
import { computeProjectFinancials } from './financials.js'

type NewAlert = typeof alerts.$inferInsert

/** Cria o alerta ou, se o mesmo fato já tem alerta, atualiza o texto (sem reabrir o que o usuário encerrou). */
export async function raiseAlert(tx: Tx, alert: NewAlert) {
  await tx
    .insert(alerts)
    .values(alert)
    .onConflictDoUpdate({
      target: [alerts.companyId, alerts.fingerprint],
      set: { title: alert.title, message: alert.message, severity: alert.severity },
    })
}

export async function resolveAlerts(tx: Tx, companyId: string, fingerprints: string[]) {
  if (!fingerprints.length) return
  await tx
    .update(alerts)
    .set({ status: 'RESOLVIDO', resolvedAt: new Date() })
    .where(and(eq(alerts.companyId, companyId), inArray(alerts.fingerprint, fingerprints), eq(alerts.status, 'ABERTO')))
}

const BUDGET_LEVELS = [
  { pct: 100, severity: 'CRITICO' as const, label: 'ultrapassou' },
  { pct: 90, severity: 'CRITICO' as const, label: 'atingiu' },
  { pct: 80, severity: 'ATENCAO' as const, label: 'atingiu' },
]

/** Reavalia orçamento das obras (após aprovar, pagar ou cancelar). */
export async function evaluateBudgetAlerts(tx: Tx, companyId: string, projectIds: string[]) {
  if (!projectIds.length) return
  const fin = await computeProjectFinancials(tx, companyId, projectIds)
  const names = await tx.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, projectIds))
  const nameOf = new Map(names.map((n) => [n.id, n.name]))

  for (const f of fin.values()) {
    const name = nameOf.get(f.projectId) ?? 'Obra'
    const reached = BUDGET_LEVELS.find((l) => f.committedPct >= l.pct)
    const toResolve: string[] = []
    for (const level of BUDGET_LEVELS) {
      const fp = `budget:${f.projectId}:${level.pct}`
      if (reached && level.pct === reached.pct) {
        await raiseAlert(tx, {
          companyId,
          type: 'ORCAMENTO',
          severity: level.severity,
          fingerprint: fp,
          projectId: f.projectId,
          title: `Obra ${name} com ${f.committedPct.toLocaleString('pt-BR')}% do orçamento`,
          message:
            level.pct === 100
              ? `O custo comprometido (${formatBRL(f.paid + f.open)}) já passou do orçamento de ${formatBRL(f.budget)}.`
              : `Revise os custos restantes antes de aprovar novas compras. Comprometido: ${formatBRL(f.paid + f.open)} de ${formatBRL(f.budget)}.`,
        })
      } else {
        toResolve.push(fp)
      }
    }
    await resolveAlerts(tx, companyId, toResolve)

    for (const [cat, c] of Object.entries(f.byCategory)) {
      const fp = `budget-cat:${f.projectId}:${cat}`
      if (c && c.budget > 0 && c.appropriated > c.budget) {
        await raiseAlert(tx, {
          companyId,
          type: 'ORCAMENTO',
          severity: 'ATENCAO',
          fingerprint: fp,
          projectId: f.projectId,
          title: `${categoryLabel(cat)} acima do orçado em ${name}`,
          message: `Apropriado ${formatBRL(c.appropriated)} para um orçamento de ${formatBRL(c.budget)} nesta categoria.`,
        })
      } else {
        await resolveAlerts(tx, companyId, [fp])
      }
    }
  }
}

/**
 * Compara preço unitário dos itens da nota com o histórico (180 dias):
 * - mesmo item mais caro que a média do próprio fornecedor → ATENÇÃO
 * - outro fornecedor vendeu o mesmo item mais barato → OPORTUNIDADE
 */
export async function evaluatePriceAlerts(tx: Tx, companyId: string, documentId: string) {
  const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId))
  if (!doc) return
  const items = await tx.select().from(documentItems).where(eq(documentItems.documentId, documentId))
  if (!items.length) return

  const since = new Date((doc.issueDate ?? new Date()).getTime() - 180 * 86400000)
  const history = await tx
    .select({
      description: documentItems.description,
      unit: documentItems.unit,
      unitPrice: documentItems.unitPrice,
      supplierId: documents.supplierId,
      supplierName: suppliers.name,
    })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(
      and(
        eq(documents.companyId, companyId),
        ne(documents.id, documentId),
        notInArray(documents.status, ['REJEITADO', 'CANCELADO']),
        gte(documents.issueDate, since),
      ),
    )

  const [supplier] = doc.supplierId ? await tx.select().from(suppliers).where(eq(suppliers.id, doc.supplierId)) : []

  for (const item of items) {
    const key = normalize(item.description)
    const price = Number(item.unitPrice)
    // itens cobrados por medição/empreitada (quantidade 1) não têm preço unitário comparável
    if (!key || price <= 0 || Number(item.quantity) <= 1) continue
    const same = history.filter((h) => normalize(h.description) === key && (h.unit ?? '') === (item.unit ?? ''))

    const own = same.filter((h) => h.supplierId === doc.supplierId).map((h) => Number(h.unitPrice))
    if (own.length) {
      const avg = own.reduce((a, b) => a + b, 0) / own.length
      const diff = (price - avg) / avg
      if (diff >= 0.15) {
        await raiseAlert(tx, {
          companyId,
          type: 'PRECO',
          severity: 'ATENCAO',
          fingerprint: `price:${documentId}:${item.id}`,
          documentId,
          supplierId: doc.supplierId,
          title: 'Variação de preço acima da média',
          message: `${item.description}: ${Math.round(diff * 100)}% mais caro que a média de ${own.length} compra(s) anteriores de ${supplier?.name ?? 'fornecedor'}.`,
        })
      }
    }

    const others = same.filter((h) => h.supplierId && h.supplierId !== doc.supplierId)
    if (others.length) {
      const cheapest = others.reduce((a, b) => (Number(a.unitPrice) <= Number(b.unitPrice) ? a : b))
      const saving = (price - Number(cheapest.unitPrice)) / price
      if (saving >= 0.1) {
        await raiseAlert(tx, {
          companyId,
          type: 'ECONOMIA',
          severity: 'OPORTUNIDADE',
          fingerprint: `saving:${doc.supplierId}:${cheapest.supplierId}:${key}`,
          documentId,
          supplierId: cheapest.supplierId,
          title: 'Oportunidade de economia',
          message: `${cheapest.supplierName ?? 'Outro fornecedor'} vendeu "${item.description}" ${Math.round(saving * 100)}% mais barato nos últimos 6 meses.`,
        })
      }
    }
  }
}

/** Títulos vencendo em até 3 dias ou vencidos. Resolve automaticamente quando pagos. */
export async function evaluateDueAlerts(tx: Tx, companyId: string, now = new Date()) {
  const limit = new Date(now.getTime() + 3 * 86400000)
  const due = await tx
    .select({ id: payables.id, dueDate: payables.dueDate, amount: payables.amount, paidAmount: payables.paidAmount, supplierName: suppliers.name, supplierId: payables.supplierId, documentId: payables.documentId })
    .from(payables)
    .leftJoin(suppliers, eq(suppliers.id, payables.supplierId))
    .where(and(eq(payables.companyId, companyId), inArray(payables.status, ['ABERTO', 'PARCIAL']), lte(payables.dueDate, limit)))

  for (const p of due) {
    const overdue = p.dueDate < startOfDay(now)
    await raiseAlert(tx, {
      companyId,
      type: 'VENCIMENTO',
      severity: overdue ? 'CRITICO' : 'ATENCAO',
      fingerprint: `due:${p.id}:${overdue ? 'late' : 'soon'}`,
      supplierId: p.supplierId,
      documentId: p.documentId,
      title: overdue ? 'Título vencido' : 'Título vence em breve',
      message: `${p.supplierName ?? 'Fornecedor'} — ${formatBRL(p.amount - p.paidAmount)} com vencimento em ${p.dueDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    })
  }

  // resolve alertas de vencimento de títulos que já não estão em aberto
  const settled = await tx
    .select({ id: payables.id })
    .from(payables)
    .where(and(eq(payables.companyId, companyId), inArray(payables.status, ['PAGO', 'CANCELADO'])))
  if (settled.length) {
    await tx
      .update(alerts)
      .set({ status: 'RESOLVIDO', resolvedAt: new Date() })
      .where(
        and(
          eq(alerts.companyId, companyId),
          eq(alerts.status, 'ABERTO'),
          eq(alerts.type, 'VENCIMENTO'),
          or(...settled.map((s) => like(alerts.fingerprint, `due:${s.id}:%`)))!,
        ),
      )
  }
  // vencido substitui "vence em breve"
  await tx.execute(sql`
    UPDATE alerts a SET status = 'RESOLVIDO', resolved_at = now()
    WHERE a.company_id = ${companyId} AND a.status = 'ABERTO' AND a.fingerprint LIKE 'due:%:soon'
      AND EXISTS (SELECT 1 FROM alerts b WHERE b.company_id = a.company_id AND b.fingerprint = replace(a.fingerprint, ':soon', ':late'))
  `)
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function categoryLabel(cat: string): string {
  return (
    {
      MATERIAIS: 'Materiais',
      MAO_DE_OBRA: 'Mão de obra',
      TERCEIRIZADOS: 'Terceirizados',
      EQUIPAMENTOS: 'Equipamentos',
      SERVICOS: 'Serviços',
      OUTROS: 'Outros',
    } as Record<string, string>
  )[cat] ?? cat
}
