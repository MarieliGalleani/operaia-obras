/**
 * Preços por material e prazo de pagamento de cada fornecedor.
 * Base: itens de notas APROVADAS. Material = descrição normalizada + unidade
 * (a mesma chave usada nos alertas de preço e de economia).
 * Itens com quantidade ≤ 1 são cobranças por medição/empreitada: aparecem, mas sem média de preço unitário.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documentItems, documents, payables, suppliers } from '../db/schema.js'
import { normalize } from '../domain/classifier.js'

const DAY = 86400000
const WINDOW_DAYS = 180

interface ItemRow {
  supplierId: string | null
  supplierName: string | null
  documentId: string
  issueDate: Date | null
  description: string
  unit: string | null
  quantity: string
  unitPrice: string
  total: number
}

export interface MaterialPrice {
  key: string
  description: string
  unit: string | null
  purchases: number
  perMeasurement: boolean
  totalQuantity: number
  totalSpent: number
  lastPrice: number
  lastDate: string | null
  avgPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  /** último preço comparado à média das compras anteriores (janela de 180 dias) */
  variationPct: number | null
  bestOther: { supplierId: string; supplierName: string; price: number; date: string | null; savingPct: number } | null
}

async function loadItems(companyId: string, supplierIds?: string[]) {
  const where = [eq(documents.companyId, companyId), eq(documents.status, 'APROVADO')]
  if (supplierIds?.length) where.push(inArray(documents.supplierId, supplierIds))
  return db
    .select({
      supplierId: documents.supplierId,
      supplierName: suppliers.tradeName,
      supplierLegal: suppliers.name,
      documentId: documents.id,
      issueDate: documents.issueDate,
      description: documentItems.description,
      unit: documentItems.unit,
      quantity: documentItems.quantity,
      unitPrice: documentItems.unitPrice,
      total: documentItems.total,
    })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(and(...where))
    .then((rows) => rows.map((r) => ({ ...r, supplierName: r.supplierName ?? r.supplierLegal })) as ItemRow[])
}

const keyOf = (r: { description: string; unit: string | null }) => `${normalize(r.description)}|${(r.unit ?? '').toUpperCase()}`
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const round2 = (v: number) => Math.round(v * 100) / 100

function summarize(rows: ItemRow[], others: ItemRow[]): MaterialPrice {
  const sorted = [...rows].sort((a, b) => (a.issueDate?.getTime() ?? 0) - (b.issueDate?.getTime() ?? 0))
  const last = sorted[sorted.length - 1]
  const perMeasurement = sorted.every((r) => Number(r.quantity) <= 1)
  const comparable = sorted.filter((r) => Number(r.quantity) > 1)
  const lastTime = last.issueDate?.getTime() ?? Date.now()
  const inWindow = comparable.filter((r) => (r.issueDate?.getTime() ?? 0) >= lastTime - WINDOW_DAYS * DAY)
  const prices = inWindow.map((r) => Number(r.unitPrice))
  const lastPrice = Number(last.unitPrice)

  let variationPct: number | null = null
  const previous = inWindow.slice(0, -1).map((r) => Number(r.unitPrice))
  if (!perMeasurement && previous.length) {
    const avgPrev = previous.reduce((a, b) => a + b, 0) / previous.length
    variationPct = avgPrev ? round2(((lastPrice - avgPrev) / avgPrev) * 100) : null
  }

  // menor preço do mesmo material em outro fornecedor, nos 180 dias antes da última compra
  let bestOther: MaterialPrice['bestOther'] = null
  if (!perMeasurement) {
    const candidates = others.filter((o) => Number(o.quantity) > 1 && (o.issueDate?.getTime() ?? 0) >= lastTime - WINDOW_DAYS * DAY)
    const cheapest = candidates.reduce<ItemRow | null>((a, b) => (!a || Number(b.unitPrice) < Number(a.unitPrice) ? b : a), null)
    if (cheapest && Number(cheapest.unitPrice) < lastPrice) {
      bestOther = {
        supplierId: cheapest.supplierId!,
        supplierName: cheapest.supplierName ?? 'Outro fornecedor',
        price: Number(cheapest.unitPrice),
        date: iso(cheapest.issueDate),
        savingPct: round2(((lastPrice - Number(cheapest.unitPrice)) / lastPrice) * 100),
      }
    }
  }

  return {
    key: keyOf(last),
    description: last.description,
    unit: last.unit,
    purchases: new Set(sorted.map((r) => r.documentId)).size,
    perMeasurement,
    totalQuantity: round2(sorted.reduce((a, r) => a + Number(r.quantity), 0)),
    totalSpent: sorted.reduce((a, r) => a + r.total, 0),
    lastPrice,
    lastDate: iso(last.issueDate),
    avgPrice: prices.length ? round2(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    variationPct,
    bestOther,
  }
}

/** Prazo médio de pagamento (emissão → vencimento), ponderado pelo valor das parcelas. */
async function paymentTerms(companyId: string, supplierIds?: string[]) {
  const where = [eq(documents.companyId, companyId), eq(documents.status, 'APROVADO')]
  if (supplierIds?.length) where.push(inArray(documents.supplierId, supplierIds))
  const rows = await db
    .select({ supplierId: documents.supplierId, issueDate: documents.issueDate, dueDate: payables.dueDate, amount: payables.amount, status: payables.status })
    .from(payables)
    .innerJoin(documents, eq(documents.id, payables.documentId))
    .where(and(...where))
  const acc = new Map<string, { days: number; weight: number }>()
  for (const r of rows) {
    if (!r.supplierId || !r.issueDate || r.status === 'CANCELADO') continue
    const days = Math.max(0, Math.round((r.dueDate.getTime() - r.issueDate.getTime()) / DAY))
    const a = acc.get(r.supplierId) ?? { days: 0, weight: 0 }
    a.days += days * r.amount
    a.weight += r.amount
    acc.set(r.supplierId, a)
  }
  return new Map([...acc].map(([id, a]) => [id, a.weight ? Math.round(a.days / a.weight) : null]))
}

/** Materiais de um fornecedor, do que mais gastou para o que menos gastou. */
export async function getSupplierPrices(companyId: string, supplierId: string) {
  const all = await loadItems(companyId)
  const own = all.filter((r) => r.supplierId === supplierId)
  const othersByKey = new Map<string, ItemRow[]>()
  for (const r of all) if (r.supplierId && r.supplierId !== supplierId) othersByKey.set(keyOf(r), [...(othersByKey.get(keyOf(r)) ?? []), r])
  const byKey = new Map<string, ItemRow[]>()
  for (const r of own) byKey.set(keyOf(r), [...(byKey.get(keyOf(r)) ?? []), r])
  const materials = [...byKey].map(([k, rows]) => summarize(rows, othersByKey.get(k) ?? [])).sort((a, b) => b.totalSpent - a.totalSpent)
  const terms = await paymentTerms(companyId, [supplierId])
  return { avgPaymentTermDays: terms.get(supplierId) ?? null, materials }
}

/** Resumo para os cards: principal material (último preço) e prazo médio de pagamento. */
export async function getSupplierPriceSummaries(companyId: string) {
  const all = await loadItems(companyId)
  const terms = await paymentTerms(companyId)
  const bySupplier = new Map<string, Map<string, ItemRow[]>>()
  for (const r of all) {
    if (!r.supplierId) continue
    const m = bySupplier.get(r.supplierId) ?? new Map<string, ItemRow[]>()
    m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r])
    bySupplier.set(r.supplierId, m)
  }
  const out = new Map<string, { avgPaymentTermDays: number | null; materials: number; topItem: Pick<MaterialPrice, 'description' | 'unit' | 'lastPrice' | 'lastDate' | 'perMeasurement' | 'variationPct'> | null }>()
  for (const [id, m] of bySupplier) {
    const top = [...m.values()].sort((a, b) => b.reduce((s, r) => s + r.total, 0) - a.reduce((s, r) => s + r.total, 0))[0]
    const t = top ? summarize(top, []) : null
    out.set(id, {
      avgPaymentTermDays: terms.get(id) ?? null,
      materials: m.size,
      topItem: t && { description: t.description, unit: t.unit, lastPrice: t.lastPrice, lastDate: t.lastDate, perMeasurement: t.perMeasurement, variationPct: t.variationPct },
    })
  }
  for (const [id, days] of terms) if (!out.has(id)) out.set(id, { avgPaymentTermDays: days, materials: 0, topItem: null })
  return out
}
