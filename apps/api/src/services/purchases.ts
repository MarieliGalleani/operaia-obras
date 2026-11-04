/**
 * Compras: pedido antes da nota e conferência pedido × nota.
 *
 * Regras:
 * - O pedido nasce RASCUNHO, é aprovado (ADMIN/GESTOR_OBRA) e só então recebe notas.
 * - A nota é vinculada sozinha quando traz o número do pedido (xPed, ex.: "PC-0012").
 *   Sem número, o sistema só SUGERE o pedido (nunca vincula por palpite).
 * - Nota sem pedido pode ser aprovada; fica com o aviso "sem pedido".
 * - Divergência de preço (> 1%), quantidade acima do pedido (> 2%) ou item não pedido
 *   vira pendência na nota e alerta do tipo PEDIDO.
 * - Situação do pedido (APROVADO → PARCIAL → ATENDIDO) segue as notas APROVADAS vinculadas.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, type Tx } from '../db/client.js'
import {
  alerts,
  documentItems,
  documents,
  projects,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  type CostCategory,
  type Issue,
} from '../db/schema.js'
import { normalize } from '../domain/classifier.js'
import { formatBRL } from '../domain/money.js'
import { audit } from './audit.js'
import { raiseAlert, resolveAlerts } from './alerts.js'
import { badRequest, conflict, notFound } from './errors.js'

const DAY = 86400000
const PRICE_TOLERANCE = 0.01
const QTY_TOLERANCE = 0.02
const OPEN: Array<'APROVADO' | 'PARCIAL'> = ['APROVADO', 'PARCIAL']
const ORDER_ISSUES = ['PEDIDO_PRECO', 'PEDIDO_QTD', 'PEDIDO_ITEM', 'SEM_PEDIDO']

export const orderCode = (n: number) => `PC-${String(n).padStart(4, '0')}`

/** "PC-0012", "pc 12", "Pedido 12" ou só "12" → 12 */
export function parseOrderRef(text: string | null | undefined): number | null {
  if (!text) return null
  const m = text.match(/PC[\s\-_]*0*(\d{1,7})/i) ?? text.trim().match(/^0*(\d{1,7})$/)
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------- comparação de itens
type ItemLike = { description: string; unit: string | null; quantity: string | number; unitPrice: string | number }
const unitOf = (u: string | null) => (u ?? '').trim().toUpperCase()
const tokens = (s: string) => new Set(normalize(s).split(' ').filter((t) => t.length > 1))
function similarity(a: string, b: string) {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

/** Item do pedido que corresponde ao item da nota: mesma descrição, ou descrição parecida com a mesma unidade. */
export function matchOrderItem<T extends ItemLike>(orderItems: T[], item: ItemLike): T | null {
  const key = normalize(item.description)
  const exact = orderItems.find((o) => normalize(o.description) === key && unitOf(o.unit) === unitOf(item.unit))
  if (exact) return exact
  let best: T | null = null
  let bestScore = 0.6
  for (const o of orderItems) {
    if (unitOf(o.unit) !== unitOf(item.unit)) continue
    const s = similarity(o.description, item.description)
    if (s >= bestScore) {
      best = o
      bestScore = s
    }
  }
  return best
}

const num = (v: string | number) => Number(v)
const round2 = (v: number) => Math.round(v * 100) / 100
const priceCents = (v: string | number) => Math.round(num(v) * 100)
const qtyFmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export interface DocConferenceLine {
  description: string
  unit: string | null
  invoicedQty: number
  invoicedPrice: number
  orderItemId: string | null
  orderedQty: number | null
  orderedPrice: number | null
  /** já recebido em outras notas aprovadas deste pedido */
  receivedBefore: number
  priceDiffPct: number | null
  problems: Array<'PRECO_ACIMA' | 'QTD_ACIMA' | 'NAO_PEDIDO'>
}

export function conferDocument(
  orderItems: Array<ItemLike & { id: string }>,
  docItems: ItemLike[],
  receivedBefore: Map<string, number>,
): DocConferenceLine[] {
  const usedInThisDoc = new Map<string, number>()
  return docItems.map((di) => {
    const oi = matchOrderItem(orderItems, di)
    const base = { description: di.description, unit: di.unit, invoicedQty: num(di.quantity), invoicedPrice: num(di.unitPrice) }
    if (!oi) return { ...base, orderItemId: null, orderedQty: null, orderedPrice: null, receivedBefore: 0, priceDiffPct: null, problems: ['NAO_PEDIDO'] }
    const before = receivedBefore.get(oi.id) ?? 0
    const sameDoc = usedInThisDoc.get(oi.id) ?? 0
    usedInThisDoc.set(oi.id, sameDoc + base.invoicedQty)
    const orderedPrice = num(oi.unitPrice)
    const orderedQty = num(oi.quantity)
    const priceDiffPct = orderedPrice ? round2(((base.invoicedPrice - orderedPrice) / orderedPrice) * 100) : null
    const problems: DocConferenceLine['problems'] = []
    if (priceDiffPct != null && priceDiffPct > PRICE_TOLERANCE * 100) problems.push('PRECO_ACIMA')
    if (before + sameDoc + base.invoicedQty > orderedQty * (1 + QTY_TOLERANCE)) problems.push('QTD_ACIMA')
    return { ...base, orderItemId: oi.id, orderedQty, orderedPrice, receivedBefore: before, priceDiffPct, problems }
  })
}

function issuesFromConference(code: string, lines: DocConferenceLine[]): Issue[] {
  const out: Issue[] = []
  for (const l of lines) {
    const name = l.description.length > 48 ? l.description.slice(0, 46) + '…' : l.description
    if (l.problems.includes('PRECO_ACIMA'))
      out.push({
        code: 'PEDIDO_PRECO',
        severity: 'ATENCAO',
        message: `${name}: ${formatBRL(priceCents(l.invoicedPrice))} na nota × ${formatBRL(priceCents(l.orderedPrice!))} no pedido ${code} (+${l.priceDiffPct!.toLocaleString('pt-BR')}%).`,
      })
    if (l.problems.includes('QTD_ACIMA'))
      out.push({
        code: 'PEDIDO_QTD',
        severity: 'ATENCAO',
        message: `${name}: chegaria a ${qtyFmt(l.receivedBefore + l.invoicedQty)} ${l.unit ?? ''} recebidos, mas o pedido ${code} tem ${qtyFmt(l.orderedQty!)}.`.replace(/\s+,/g, ','),
      })
    if (l.problems.includes('NAO_PEDIDO'))
      out.push({ code: 'PEDIDO_ITEM', severity: 'ATENCAO', message: `${name}: item não consta no pedido ${code}.` })
  }
  return out
}

// ---------------------------------------------------------------- leitura
async function loadOrder(tx: Tx | typeof db, companyId: string, id: string) {
  const [o] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, id)))
  if (!o) throw notFound('Pedido')
  return o
}

/** Quantidade recebida por item do pedido nas notas APROVADAS (exceto a nota informada). */
async function receivedByItem(tx: Tx | typeof db, orderId: string, exceptDocumentId?: string) {
  const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, orderId))
  const docs = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.purchaseOrderId, orderId), eq(documents.status, 'APROVADO')))
  const ids = docs.map((d) => d.id).filter((d) => d !== exceptDocumentId)
  const received = new Map<string, number>()
  if (ids.length) {
    const rows = await tx.select().from(documentItems).where(inArray(documentItems.documentId, ids))
    for (const r of rows) {
      const oi = matchOrderItem(items, r)
      if (oi) received.set(oi.id, (received.get(oi.id) ?? 0) + num(r.quantity))
    }
  }
  return { items, received, approvedDocs: ids.length }
}

/** Atualiza a situação do pedido conforme o que já chegou em notas aprovadas. */
export async function refreshOrderStatus(tx: Tx, orderId: string) {
  const [o] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId))
  if (!o || o.status === 'RASCUNHO' || o.status === 'CANCELADO') return
  const { items, received, approvedDocs } = await receivedByItem(tx, orderId)
  const complete = items.length > 0 && items.every((i) => (received.get(i.id) ?? 0) >= num(i.quantity) * (1 - QTY_TOLERANCE))
  const status = !approvedDocs ? 'APROVADO' : complete ? 'ATENDIDO' : 'PARCIAL'
  if (status !== o.status) await tx.update(purchaseOrders).set({ status, updatedAt: new Date() }).where(eq(purchaseOrders.id, orderId))
}

/** Prazo de entrega: data da nota comparada à data prometida, por nota aprovada vinculada. */
async function deliveries(companyId: string) {
  const rows = await db
    .select({
      orderId: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      expectedDate: purchaseOrders.expectedDate,
      approvedAt: purchaseOrders.approvedAt,
      issueDate: documents.issueDate,
    })
    .from(documents)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, documents.purchaseOrderId))
    .where(and(eq(documents.companyId, companyId), eq(documents.status, 'APROVADO')))
  return rows.map((r) => ({
    ...r,
    delayDays: r.expectedDate && r.issueDate ? Math.round((dayStart(r.issueDate) - dayStart(r.expectedDate)) / DAY) : null,
    leadDays: r.approvedAt && r.issueDate ? Math.max(0, Math.round((dayStart(r.issueDate) - dayStart(r.approvedAt)) / DAY)) : null,
  }))
}
const dayStart = (d: Date) => new Date(d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00').getTime()

export interface DeliveryStats {
  deliveries: number
  onTimePct: number | null
  avgDelayDays: number | null
  avgLeadDays: number | null
  lateOpenOrders: number
}

/** Pontualidade de entrega por fornecedor (base: pedidos com nota aprovada). */
export async function getDeliveryStats(companyId: string) {
  const [rows, open] = await Promise.all([
    deliveries(companyId),
    db
      .select({ supplierId: purchaseOrders.supplierId, expectedDate: purchaseOrders.expectedDate })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.companyId, companyId), inArray(purchaseOrders.status, OPEN))),
  ])
  const out = new Map<string, DeliveryStats>()
  const get = (id: string) => out.get(id) ?? { deliveries: 0, onTimePct: null, avgDelayDays: null, avgLeadDays: null, lateOpenOrders: 0 }
  const acc = new Map<string, { n: number; onTime: number; delay: number; late: number; lead: number; leadN: number }>()
  for (const r of rows) {
    if (r.delayDays == null) continue
    const a = acc.get(r.supplierId) ?? { n: 0, onTime: 0, delay: 0, late: 0, lead: 0, leadN: 0 }
    a.n++
    if (r.delayDays <= 0) a.onTime++
    else {
      a.late++
      a.delay += r.delayDays
    }
    if (r.leadDays != null) {
      a.lead += r.leadDays
      a.leadN++
    }
    acc.set(r.supplierId, a)
  }
  for (const [id, a] of acc)
    out.set(id, {
      ...get(id),
      deliveries: a.n,
      onTimePct: Math.round((a.onTime / a.n) * 100),
      avgDelayDays: a.late ? round2(a.delay / a.late) : 0,
      avgLeadDays: a.leadN ? Math.round(a.lead / a.leadN) : null,
    })
  const today = dayStart(new Date())
  for (const o of open) if (o.expectedDate && dayStart(o.expectedDate) < today) out.set(o.supplierId, { ...get(o.supplierId), lateOpenOrders: get(o.supplierId).lateOpenOrders + 1 })
  return out
}

export async function listOrders(companyId: string, filters: { status?: string; projectId?: string; supplierId?: string } = {}) {
  const where = [eq(purchaseOrders.companyId, companyId)]
  if (filters.status) where.push(inArray(purchaseOrders.status, filters.status.split(',') as any))
  if (filters.projectId) where.push(eq(purchaseOrders.projectId, filters.projectId))
  if (filters.supplierId) where.push(eq(purchaseOrders.supplierId, filters.supplierId))
  const rows = await db
    .select({
      order: purchaseOrders,
      projectName: projects.name,
      projectCode: projects.code,
      supplierName: sql<string>`coalesce(${suppliers.tradeName}, ${suppliers.name})`,
      itemsCount: sql<number>`(SELECT count(*)::int FROM purchase_order_items i WHERE i.order_id = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(...where))
    .orderBy(desc(purchaseOrders.number))
  const ids = rows.map((r) => r.order.id)
  const docs = ids.length
    ? await db
        .select({ orderId: documents.purchaseOrderId, status: documents.status, totalAmount: documents.totalAmount, issues: documents.issues, issueDate: documents.issueDate })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), inArray(documents.purchaseOrderId, ids)))
    : []
  const today = dayStart(new Date())
  return rows.map(({ order, ...r }) => {
    const mine = docs.filter((d) => d.orderId === order.id && d.status !== 'REJEITADO' && d.status !== 'CANCELADO')
    const approved = mine.filter((d) => d.status === 'APROVADO')
    const open = OPEN.includes(order.status as any)
    return {
      ...order,
      code: orderCode(order.number),
      ...r,
      documentsCount: mine.length,
      invoicedTotal: approved.reduce((a, d) => a + (d.totalAmount ?? 0), 0),
      pendingDocuments: mine.length - approved.length,
      divergent: mine.some((d) => d.status !== 'APROVADO' && (d.issues ?? []).some((i) => i.code.startsWith('PEDIDO_'))),
      late: open && !!order.expectedDate && dayStart(order.expectedDate) < today,
      lastDeliveryDate: approved.reduce<Date | null>((a, d) => (d.issueDate && (!a || d.issueDate > a) ? d.issueDate : a), null),
    }
  })
}

export async function getOrder(companyId: string, id: string) {
  const order = await loadOrder(db, companyId, id)
  const [project, supplier, items, docs, history] = await Promise.all([
    db.query.projects.findFirst({ where: eq(projects.id, order.projectId) }),
    db.query.suppliers.findFirst({ where: eq(suppliers.id, order.supplierId) }),
    db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id)),
    db
      .select({ id: documents.id, number: documents.number, issueDate: documents.issueDate, totalAmount: documents.totalAmount, status: documents.status, issues: documents.issues })
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.purchaseOrderId, id)))
      .orderBy(documents.issueDate),
    db.execute(sql`SELECT a.action, a.created_at AS "createdAt", u.name AS "userName" FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.company_id = ${companyId} AND a.entity = 'purchase_order' AND a.entity_id = ${id} ORDER BY a.created_at`),
  ])
  const live = docs.filter((d) => d.status !== 'REJEITADO' && d.status !== 'CANCELADO')
  const docItemRows = live.length ? await db.select().from(documentItems).where(inArray(documentItems.documentId, live.map((d) => d.id))) : []

  // conferência consolidada: pedido × tudo o que chegou
  const lines = items.map((i) => ({
    id: i.id,
    description: i.description,
    unit: i.unit,
    orderedQty: num(i.quantity),
    orderedPrice: num(i.unitPrice),
    total: i.total,
    receivedQty: 0,
    inReviewQty: 0,
    lastInvoicedPrice: null as number | null,
    priceAbove: false,
  }))
  const extras: Array<{ description: string; unit: string | null; quantity: number; unitPrice: number; documentNumber: string | null }> = []
  for (const d of live) {
    for (const r of docItemRows.filter((x) => x.documentId === d.id)) {
      const oi = matchOrderItem(items, r)
      const line = oi && lines.find((l) => l.id === oi.id)
      if (!line) {
        extras.push({ description: r.description, unit: r.unit, quantity: num(r.quantity), unitPrice: num(r.unitPrice), documentNumber: d.number })
        continue
      }
      if (d.status === 'APROVADO') line.receivedQty += num(r.quantity)
      else line.inReviewQty += num(r.quantity)
      line.lastInvoicedPrice = num(r.unitPrice)
      if (num(r.unitPrice) > line.orderedPrice * (1 + PRICE_TOLERANCE)) line.priceAbove = true
    }
  }
  const delivery = (await deliveries(companyId)).filter((r) => r.orderId === id)
  return {
    ...order,
    code: orderCode(order.number),
    project: project && { id: project.id, code: project.code, name: project.name },
    supplier: supplier && { id: supplier.id, name: supplier.tradeName ?? supplier.name, legalName: supplier.name, cnpj: supplier.cnpj, status: supplier.status },
    items: lines.map((l) => ({
      ...l,
      receivedQty: round2(l.receivedQty),
      inReviewQty: round2(l.inReviewQty),
      situation: l.receivedQty >= l.orderedQty * (1 - QTY_TOLERANCE) ? (l.receivedQty > l.orderedQty * (1 + QTY_TOLERANCE) ? 'ACIMA' : 'ENTREGUE') : l.receivedQty > 0 ? 'PARCIAL' : 'PENDENTE',
    })),
    extras,
    documents: docs,
    deliveries: delivery.map((d) => ({ issueDate: d.issueDate, delayDays: d.delayDays })),
    history: history.rows,
  }
}

// ---------------------------------------------------------------- escrita
export interface OrderInput {
  projectId: string
  supplierId: string
  category?: CostCategory
  expectedDate?: string | null
  paymentTerms?: string | null
  notes?: string | null
  items: Array<{ description: string; unit?: string | null; quantity: number; unitPrice: number }>
}

async function validateRefs(tx: Tx, companyId: string, input: Pick<OrderInput, 'projectId' | 'supplierId' | 'items'>) {
  const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, input.projectId)))
  if (!p) throw badRequest('OBRA_INVALIDA', 'Obra não encontrada para esta construtora.')
  const [s] = await tx.select().from(suppliers).where(and(eq(suppliers.companyId, companyId), eq(suppliers.id, input.supplierId)))
  if (!s) throw badRequest('FORNECEDOR_INVALIDO', 'Fornecedor não encontrado para esta construtora.')
  if (s.status === 'BLOQUEADO') throw conflict('FORNECEDOR_BLOQUEADO', 'Fornecedor bloqueado: não é possível fazer pedido.')
  if (!input.items.length) throw badRequest('SEM_ITENS', 'Inclua ao menos um item no pedido.')
  if (input.items.some((i) => !(i.quantity > 0) || !(i.unitPrice >= 0) || !i.description.trim())) throw badRequest('ITEM_INVALIDO', 'Itens precisam de descrição, quantidade e preço.')
}

const itemRows = (orderId: string, items: OrderInput['items']) =>
  items.map((i) => ({
    orderId,
    description: i.description.trim().toUpperCase(),
    unit: i.unit?.trim().toUpperCase() || null,
    quantity: String(i.quantity),
    unitPrice: String(i.unitPrice),
    total: Math.round(i.quantity * i.unitPrice * 100),
  }))

const dateOrNull = (ymd?: string | null) => (ymd ? new Date(`${ymd}T12:00:00-03:00`) : null)

export async function createOrder(companyId: string, user: { id: string; name: string }, input: OrderInput) {
  const id = await db.transaction(async (tx) => {
    await validateRefs(tx, companyId, input)
    // número sequencial sem colisão entre pedidos criados ao mesmo tempo
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'po:' + companyId}))`)
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${purchaseOrders.number}), 0)::int + 1` })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.companyId, companyId))
    const rows = itemRows('', input.items)
    const [o] = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        number: next,
        projectId: input.projectId,
        supplierId: input.supplierId,
        category: input.category ?? 'MATERIAIS',
        expectedDate: dateOrNull(input.expectedDate),
        paymentTerms: input.paymentTerms,
        notes: input.notes,
        total: rows.reduce((a, r) => a + r.total, 0),
        createdById: user.id,
        createdByName: user.name,
      })
      .returning({ id: purchaseOrders.id })
    await tx.insert(purchaseOrderItems).values(rows.map((r) => ({ ...r, orderId: o.id })))
    await audit(tx, { companyId, userId: user.id, entity: 'purchase_order', entityId: o.id, action: 'created', data: input })
    return o.id
  })
  return getOrder(companyId, id)
}

export async function updateOrder(companyId: string, userId: string, id: string, input: Partial<OrderInput>) {
  await db.transaction(async (tx) => {
    const o = await loadOrder(tx, companyId, id)
    if (o.status !== 'RASCUNHO') throw conflict('STATUS_INVALIDO', 'Só pedidos em rascunho podem ser editados.')
    const merged = { projectId: input.projectId ?? o.projectId, supplierId: input.supplierId ?? o.supplierId, items: input.items ?? [{ description: 'x', quantity: 1, unitPrice: 0 }] }
    await validateRefs(tx, companyId, merged)
    const set: Partial<typeof purchaseOrders.$inferInsert> = { updatedAt: new Date(), projectId: merged.projectId, supplierId: merged.supplierId }
    if (input.category) set.category = input.category
    if (input.expectedDate !== undefined) set.expectedDate = dateOrNull(input.expectedDate)
    if (input.paymentTerms !== undefined) set.paymentTerms = input.paymentTerms
    if (input.notes !== undefined) set.notes = input.notes
    if (input.items) {
      const rows = itemRows(id, input.items)
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id))
      await tx.insert(purchaseOrderItems).values(rows)
      set.total = rows.reduce((a, r) => a + r.total, 0)
    }
    await tx.update(purchaseOrders).set(set).where(eq(purchaseOrders.id, id))
    await audit(tx, { companyId, userId, entity: 'purchase_order', entityId: id, action: 'updated', data: input })
  })
  return getOrder(companyId, id)
}

export async function approveOrder(companyId: string, user: { id: string; name: string }, id: string) {
  await db.transaction(async (tx) => {
    const o = await loadOrder(tx, companyId, id)
    if (o.status !== 'RASCUNHO') throw conflict('STATUS_INVALIDO', `Pedido está ${o.status}.`)
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, o.supplierId))
    if (s?.status === 'BLOQUEADO') throw conflict('FORNECEDOR_BLOQUEADO', 'Fornecedor bloqueado: não é possível aprovar o pedido.')
    await tx
      .update(purchaseOrders)
      .set({ status: 'APROVADO', approvedById: user.id, approvedByName: user.name, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
    await audit(tx, { companyId, userId: user.id, entity: 'purchase_order', entityId: id, action: 'approved' })
  })
  return getOrder(companyId, id)
}

export async function cancelOrder(companyId: string, userId: string, id: string, reason: string) {
  await db.transaction(async (tx) => {
    const o = await loadOrder(tx, companyId, id)
    if (o.status === 'CANCELADO') return
    const linked = await tx.select({ id: documents.id, status: documents.status }).from(documents).where(eq(documents.purchaseOrderId, id))
    if (linked.some((d) => d.status === 'APROVADO')) throw conflict('POSSUI_NOTA', 'Este pedido já tem nota aprovada. Cancele ou estorne a nota antes.')
    await tx.update(purchaseOrders).set({ status: 'CANCELADO', cancelReason: reason, updatedAt: new Date() }).where(eq(purchaseOrders.id, id))
    for (const d of linked.filter((x) => x.status === 'RECEBIDO' || x.status === 'EM_REVISAO')) await applyLink(tx, companyId, userId, d.id, null, 'pedido cancelado')
    await audit(tx, { companyId, userId, entity: 'purchase_order', entityId: id, action: 'cancelled', data: { reason } })
  })
  return getOrder(companyId, id)
}

// ---------------------------------------------------------------- nota × pedido
async function companyUsesOrders(tx: Tx | typeof db, companyId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(purchaseOrders).where(and(eq(purchaseOrders.companyId, companyId), sql`${purchaseOrders.status} <> 'RASCUNHO'`))
  return r.n > 0
}

/** Vincula (ou desvincula, com orderId null) e refaz as pendências de pedido da nota. */
async function applyLink(tx: Tx, companyId: string, userId: string | null | undefined, documentId: string, orderId: string | null, reason: string) {
  const [doc] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, documentId)))
  if (!doc) throw notFound('Documento')
  let order: typeof purchaseOrders.$inferSelect | null = null
  if (orderId) {
    order = await loadOrder(tx, companyId, orderId)
    if (!OPEN.includes(order.status as any) && order.id !== doc.purchaseOrderId) throw conflict('PEDIDO_FECHADO', `O pedido ${orderCode(order.number)} está ${order.status}.`)
    if (doc.supplierId && order.supplierId !== doc.supplierId) throw badRequest('FORNECEDOR_DIFERENTE', 'O pedido é de outro fornecedor.')
  }

  let issues = (doc.issues ?? []).filter((i) => !ORDER_ISSUES.includes(i.code))
  const set: Partial<typeof documents.$inferInsert> = { purchaseOrderId: order?.id ?? null, updatedAt: new Date() }
  const fingerprint = `po:${documentId}`

  if (order) {
    const { items, received } = await receivedByItem(tx, order.id, documentId)
    const docItems = await tx.select().from(documentItems).where(eq(documentItems.documentId, documentId))
    const lines = conferDocument(items, docItems, received)
    const found = issuesFromConference(orderCode(order.number), lines)
    issues = [...issues, ...found]
    // o pedido diz qual é a obra: resolve "obra não identificada"
    if (issues.some((i) => i.code === 'OBRA_NAO_IDENTIFICADA')) {
      issues = issues.filter((i) => i.code !== 'OBRA_NAO_IDENTIFICADA')
      set.suggestedProjectId = order.projectId
      const cat = doc.suggestionReason?.match(/categoria:.*/)?.[0]
      set.suggestionReason = `obra do pedido ${orderCode(order.number)}${cat ? '; ' + cat : ''}`
      await resolveAlerts(tx, companyId, [`noproject:${documentId}`])
    }
    if (found.length) {
      const [s] = doc.supplierId ? await tx.select().from(suppliers).where(eq(suppliers.id, doc.supplierId)) : []
      await raiseAlert(tx, {
        companyId,
        type: 'PEDIDO',
        severity: 'ATENCAO',
        fingerprint,
        documentId,
        projectId: order.projectId,
        supplierId: order.supplierId,
        title: `${doc.number ? `NF ${doc.number}` : 'Nota'} diverge do pedido ${orderCode(order.number)}`,
        message: `${s?.tradeName ?? s?.name ?? 'Fornecedor'}: ${found.map((f) => f.message).join(' ')}`,
      })
      // se o usuário tinha encerrado e a divergência continua, volta a abrir
      await tx.update(alerts).set({ status: 'ABERTO', resolvedAt: null }).where(and(eq(alerts.companyId, companyId), eq(alerts.fingerprint, fingerprint)))
    } else await resolveAlerts(tx, companyId, [fingerprint])
  } else {
    await resolveAlerts(tx, companyId, [fingerprint])
    if (await companyUsesOrders(tx, companyId)) issues.push({ code: 'SEM_PEDIDO', severity: 'INFO', message: 'Nota sem pedido de compra. Pode ser aprovada mesmo assim.' })
  }

  set.issues = issues
  if (doc.status === 'RECEBIDO' || doc.status === 'EM_REVISAO') set.status = issues.some((i) => i.severity !== 'INFO') ? 'EM_REVISAO' : 'RECEBIDO'
  await tx.update(documents).set(set).where(eq(documents.id, documentId))
  if (doc.purchaseOrderId && doc.purchaseOrderId !== order?.id) await refreshOrderStatus(tx, doc.purchaseOrderId)
  if (order) await refreshOrderStatus(tx, order.id)
  await audit(tx, {
    companyId,
    userId,
    entity: 'document',
    entityId: documentId,
    action: order ? 'linked_order' : 'unlinked_order',
    data: { orderId: order?.id ?? null, code: order ? orderCode(order.number) : null, reason },
  })
}

export async function linkDocumentToOrder(companyId: string, userId: string, documentId: string, orderId: string | null) {
  await db.transaction(async (tx) => {
    const [doc] = await tx.select({ status: documents.status }).from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, documentId)))
    if (!doc) throw notFound('Documento')
    if (doc.status !== 'RECEBIDO' && doc.status !== 'EM_REVISAO') throw conflict('STATUS_INVALIDO', 'Só é possível trocar o pedido de notas ainda não aprovadas.')
    await applyLink(tx, companyId, userId, documentId, orderId, 'manual')
  })
}

/** Na entrada da nota: vincula sozinho quando a nota traz o número do pedido; senão marca "sem pedido". */
export async function autoLinkDocument(companyId: string, documentId: string, purchaseOrderRef: string | null) {
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId))
    if (!doc?.supplierId) return
    const ref = parseOrderRef(purchaseOrderRef)
    const [order] = ref
      ? await tx
          .select()
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.number, ref), eq(purchaseOrders.supplierId, doc.supplierId), inArray(purchaseOrders.status, OPEN)))
      : []
    if (order) return applyLink(tx, companyId, null, documentId, order.id, 'número do pedido na nota')
    if (await companyUsesOrders(tx, companyId)) {
      await tx
        .update(documents)
        .set({ issues: [...(doc.issues ?? []), { code: 'SEM_PEDIDO', severity: 'INFO', message: 'Nota sem pedido de compra. Pode ser aprovada mesmo assim.' }] })
        .where(eq(documents.id, documentId))
    }
  })
}

/** Para a tela de conferência: pedido vinculado com a conferência desta nota, ou pedidos em aberto do fornecedor. */
export async function documentOrderInfo(companyId: string, doc: { id: string; supplierId: string | null; purchaseOrderId: string | null; suggestedProjectId: string | null; status: string }) {
  if (doc.purchaseOrderId) {
    const [o] = await db
      .select({ order: purchaseOrders, projectName: projects.name })
      .from(purchaseOrders)
      .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(eq(purchaseOrders.id, doc.purchaseOrderId))
    if (o) {
      const { items, received } = await receivedByItem(db, o.order.id, doc.id)
      const docItems = await db.select().from(documentItems).where(eq(documentItems.documentId, doc.id))
      return {
        purchaseOrder: {
          id: o.order.id,
          code: orderCode(o.order.number),
          status: o.order.status,
          projectId: o.order.projectId,
          projectName: o.projectName,
          expectedDate: o.order.expectedDate,
          total: o.order.total,
        },
        orderConference: conferDocument(items, docItems, received),
        orderCandidates: [],
      }
    }
  }
  if (!doc.supplierId || (doc.status !== 'RECEBIDO' && doc.status !== 'EM_REVISAO')) return { purchaseOrder: null, orderConference: [], orderCandidates: [] }
  const candidates = await db
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, total: purchaseOrders.total, expectedDate: purchaseOrders.expectedDate, projectId: purchaseOrders.projectId, projectName: projects.name })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.supplierId, doc.supplierId), inArray(purchaseOrders.status, OPEN)))
    .orderBy(purchaseOrders.number)
  // a obra sugerida para a nota vem primeiro
  candidates.sort((a, b) => Number(b.projectId === doc.suggestedProjectId) - Number(a.projectId === doc.suggestedProjectId))
  return { purchaseOrder: null, orderConference: [], orderCandidates: candidates.map((c) => ({ ...c, code: orderCode(c.number) })) }
}
