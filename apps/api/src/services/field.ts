/**
 * App de obra (mestre): pedir material, receber entrega, fotos, ocorrências e avanço físico.
 *
 * Regras:
 * - Nada aqui devolve valores em dinheiro: o mestre vê quantidades, não preços.
 * - Recebimento na obra é separado da nota: confirma o que chegou de fato no canteiro.
 *   A conferência vira três pontas: pedido × nota × recebimento.
 * - Ocorrência ALTA vira alerta crítico; MÉDIA vira alerta de atenção. Entrega com problema abre ocorrência.
 * - Avanço físico = média das etapas ponderada pelo peso de cada uma.
 */
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { projectInScope, type Scope } from './scope.js'
import {
  deliveryReceipts,
  materialRequests,
  occurrences,
  projectStages,
  projects,
  purchaseOrderItems,
  purchaseOrders,
  sitePhotos,
  stageUpdates,
  suppliers,
  type FieldItem,
} from '../db/schema.js'
import { raiseAlert, resolveAlerts } from './alerts.js'
import { audit } from './audit.js'
import { badRequest, conflict, notFound } from './errors.js'
import { orderCode } from './purchases.js'

type User = { id: string; name: string }
const DAY = 86400000
const dayStart = (d: Date) => new Date(d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00').getTime()
const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Hora em que o registro aconteceu no canteiro (pode ter ficado na fila do celular sem internet).
 * Não aceita futuro nem mais de 30 dias atrás.
 */
export function happenedAt(iso?: string | null) {
  const now = Date.now()
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return new Date(now)
  return new Date(Math.min(now, Math.max(now - 30 * DAY, t)))
}

export const OCCURRENCE_LABEL: Record<string, string> = {
  FALTA_MATERIAL: 'Falta de material',
  ATRASO: 'Atraso',
  SEGURANCA: 'Segurança',
  QUALIDADE: 'Qualidade',
  CLIMA: 'Clima',
  ENTREGA: 'Entrega',
  OUTRO: 'Outro',
}

/** Etapas sugeridas para obra nova (pesos ≈ participação no custo). */
export const DEFAULT_STAGES = [
  { name: 'Serviços preliminares', weight: 5 },
  { name: 'Fundação', weight: 12 },
  { name: 'Estrutura', weight: 22 },
  { name: 'Alvenaria', weight: 14 },
  { name: 'Cobertura', weight: 8 },
  { name: 'Instalações elétricas e hidráulicas', weight: 15 },
  { name: 'Revestimentos e acabamento', weight: 19 },
  { name: 'Limpeza e entrega', weight: 5 },
]

export function physicalProgress(stages: Array<{ weight: number; progress: number }>) {
  const w = stages.reduce((a, s) => a + s.weight, 0)
  return w ? round2(stages.reduce((a, s) => a + s.weight * s.progress, 0) / w) : null
}

async function ownProject(companyId: string, projectId: string) {
  const p = await db.query.projects.findFirst({ where: and(eq(projects.companyId, companyId), eq(projects.id, projectId)) })
  if (!p) throw notFound('Obra')
  return p
}

// ---------------------------------------------------------------- leitura
/** Obras em andamento, com o que o mestre precisa ver de relance. */
export async function fieldProjects(companyId: string) {
  const list = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, address: projects.address, imageUrl: projects.imageUrl })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.status, 'ATIVA')))
    .orderBy(projects.code)
  const ids = list.map((p) => p.id)
  if (!ids.length) return []
  const [stages, orders, occ, reqs] = await Promise.all([
    db.select({ projectId: projectStages.projectId, weight: projectStages.weight, progress: projectStages.progress }).from(projectStages).where(inArray(projectStages.projectId, ids)),
    db
      .select({ projectId: purchaseOrders.projectId, expectedDate: purchaseOrders.expectedDate })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.companyId, companyId), inArray(purchaseOrders.status, ['APROVADO', 'PARCIAL']))),
    db.select({ projectId: occurrences.projectId, severity: occurrences.severity }).from(occurrences).where(and(eq(occurrences.companyId, companyId), eq(occurrences.status, 'ABERTA'))),
    db.select({ projectId: materialRequests.projectId }).from(materialRequests).where(and(eq(materialRequests.companyId, companyId), eq(materialRequests.status, 'ABERTA'))),
  ])
  const today = dayStart(new Date())
  return list.map((p) => {
    const mine = orders.filter((o) => o.projectId === p.id)
    return {
      ...p,
      physicalPct: physicalProgress(stages.filter((s) => s.projectId === p.id)),
      expectedDeliveries: mine.length,
      lateDeliveries: mine.filter((o) => o.expectedDate && dayStart(o.expectedDate) < today).length,
      deliveriesToday: mine.filter((o) => o.expectedDate && dayStart(o.expectedDate) === today).length,
      openOccurrences: occ.filter((o) => o.projectId === p.id).length,
      highOccurrences: occ.filter((o) => o.projectId === p.id && o.severity === 'ALTA').length,
      openRequests: reqs.filter((r) => r.projectId === p.id).length,
    }
  })
}

/** Recebido na obra por item de pedido. */
async function fieldReceivedByItem(orderIds: string[]) {
  const map = new Map<string, number>()
  if (!orderIds.length) return map
  const rows = await db.select({ items: deliveryReceipts.items }).from(deliveryReceipts).where(inArray(deliveryReceipts.orderId, orderIds))
  for (const r of rows) for (const i of r.items) map.set(i.orderItemId, (map.get(i.orderItemId) ?? 0) + i.quantity)
  return map
}

export async function fieldProject(companyId: string, projectId: string) {
  const p = await ownProject(companyId, projectId)
  const since = new Date(Date.now() - 45 * DAY)
  const [stages, orders, receipts, requests, occ, photos, updates] = await Promise.all([
    db.select().from(projectStages).where(eq(projectStages.projectId, projectId)).orderBy(projectStages.sortOrder),
    db
      .select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, expectedDate: purchaseOrders.expectedDate, supplierName: sql<string>`coalesce(${suppliers.tradeName}, ${suppliers.name})` })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(eq(purchaseOrders.projectId, projectId), inArray(purchaseOrders.status, ['APROVADO', 'PARCIAL'])))
      .orderBy(purchaseOrders.expectedDate),
    db
      .select({ r: deliveryReceipts, number: purchaseOrders.number, supplierName: sql<string>`coalesce(${suppliers.tradeName}, ${suppliers.name})` })
      .from(deliveryReceipts)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, deliveryReceipts.orderId))
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(eq(deliveryReceipts.projectId, projectId), gte(deliveryReceipts.receivedAt, since)))
      .orderBy(desc(deliveryReceipts.receivedAt)),
    db
      .select({ r: materialRequests, orderNumber: purchaseOrders.number, orderStatus: purchaseOrders.status })
      .from(materialRequests)
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, materialRequests.orderId))
      .where(and(eq(materialRequests.projectId, projectId), or(eq(materialRequests.status, 'ABERTA'), gte(materialRequests.createdAt, since))))
      .orderBy(desc(materialRequests.createdAt)),
    db
      .select()
      .from(occurrences)
      .where(and(eq(occurrences.projectId, projectId), or(eq(occurrences.status, 'ABERTA'), gte(occurrences.createdAt, since))))
      .orderBy(desc(occurrences.createdAt)),
    db.select().from(sitePhotos).where(eq(sitePhotos.projectId, projectId)).orderBy(desc(sitePhotos.createdAt)).limit(40),
    db.select().from(stageUpdates).where(eq(stageUpdates.projectId, projectId)).orderBy(desc(stageUpdates.createdAt)).limit(30),
  ])
  const items = orders.length ? await db.select().from(purchaseOrderItems).where(inArray(purchaseOrderItems.orderId, orders.map((o) => o.id))) : []
  const received = await fieldReceivedByItem(orders.map((o) => o.id))
  const today = dayStart(new Date())
  const photosOf = (key: 'occurrenceId' | 'receiptId' | 'stageUpdateId', id: string) => photos.filter((f) => f[key] === id).map((f) => f.url)
  const stageName = new Map(stages.map((s) => [s.id, s.name]))

  return {
    project: { id: p.id, code: p.code, name: p.name, address: p.address, imageUrl: p.imageUrl, status: p.status },
    physicalPct: physicalProgress(stages),
    stages: stages.map((s) => ({ id: s.id, name: s.name, weight: s.weight, progress: s.progress, updatedAt: s.updatedAt, updatedByName: s.updatedByName })),
    deliveries: orders.map((o) => ({
      id: o.id,
      code: orderCode(o.number),
      status: o.status,
      supplierName: o.supplierName,
      expectedDate: o.expectedDate,
      late: !!o.expectedDate && dayStart(o.expectedDate) < today,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => {
          const ordered = Number(i.quantity)
          const got = round2(received.get(i.id) ?? 0)
          return { id: i.id, description: i.description, unit: i.unit, orderedQty: ordered, receivedQty: got, remainingQty: Math.max(0, round2(ordered - got)) }
        }),
    })),
    receipts: receipts.map(({ r, number, supplierName }) => ({
      id: r.id,
      orderId: r.orderId,
      code: orderCode(number),
      supplierName,
      items: r.items,
      problem: r.problem,
      notes: r.notes,
      receivedAt: r.receivedAt,
      receivedByName: r.receivedByName,
      photos: photosOf('receiptId', r.id),
    })),
    requests: requests.map(({ r, orderNumber, orderStatus }) => ({
      id: r.id,
      status: r.status,
      items: r.items,
      neededBy: r.neededBy,
      urgent: r.urgent,
      notes: r.notes,
      createdAt: r.createdAt,
      createdByName: r.createdByName,
      declineReason: r.declineReason,
      orderCode: orderNumber ? orderCode(orderNumber) : null,
      orderStatus,
    })),
    occurrences: occ.map((o) => ({ ...o, typeLabel: OCCURRENCE_LABEL[o.type], photos: photosOf('occurrenceId', o.id) })),
    photos: photos.map((f) => ({ id: f.id, url: f.url, caption: f.caption, createdAt: f.createdAt, userName: f.userName, kind: f.occurrenceId ? 'OCORRENCIA' : f.receiptId ? 'ENTREGA' : f.stageUpdateId ? 'AVANCO' : 'DIARIO' })),
    stageUpdates: updates.map((u) => ({ ...u, stageName: stageName.get(u.stageId) ?? 'Etapa', photos: photosOf('stageUpdateId', u.id) })),
  }
}

// ---------------------------------------------------------------- escrita (campo)
const cleanItems = (items: Array<Omit<FieldItem, 'unit'> & { unit?: string | null }>) =>
  items
    .map((i) => ({ description: i.description.trim().toUpperCase(), unit: i.unit?.trim().toUpperCase() || null, quantity: Number(i.quantity) }))
    .filter((i) => i.description && i.quantity > 0)

export async function createMaterialRequest(
  companyId: string,
  user: User,
  projectId: string,
  input: { items: Array<Omit<FieldItem, 'unit'> & { unit?: string | null }>; neededBy?: string | null; urgent?: boolean; notes?: string | null; happenedAt?: string | null },
) {
  await ownProject(companyId, projectId)
  const items = cleanItems(input.items)
  if (!items.length) throw badRequest('SEM_ITENS', 'Informe ao menos um material com quantidade.')
  const [r] = await db
    .insert(materialRequests)
    .values({
      companyId,
      projectId,
      items,
      neededBy: input.neededBy ? new Date(`${input.neededBy}T12:00:00-03:00`) : null,
      urgent: !!input.urgent,
      notes: input.notes,
      createdById: user.id,
      createdByName: user.name,
      createdAt: happenedAt(input.happenedAt),
    })
    .returning()
  await audit(db, { companyId, userId: user.id, entity: 'material_request', entityId: r.id, action: 'created', data: input })
  return r
}

export async function receiveDelivery(
  companyId: string,
  user: User,
  orderId: string,
  input: { items: Array<{ orderItemId: string; quantity: number }>; problem?: boolean; notes?: string | null; happenedAt?: string | null },
) {
  const when = happenedAt(input.happenedAt)
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.id, orderId)))
    if (!o) throw notFound('Pedido')
    if (o.status === 'RASCUNHO' || o.status === 'CANCELADO') throw conflict('PEDIDO_FECHADO', `O pedido ${orderCode(o.number)} não está liberado para entrega.`)
    const orderItems = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, orderId))
    const items = input.items
      .filter((i) => i.quantity > 0)
      .map((i) => {
        const oi = orderItems.find((x) => x.id === i.orderItemId)
        if (!oi) throw badRequest('ITEM_INVALIDO', 'Item não pertence a este pedido.')
        return { orderItemId: oi.id, description: oi.description, unit: oi.unit, quantity: Number(i.quantity) }
      })
    if (!items.length && !input.problem) throw badRequest('SEM_ITENS', 'Informe a quantidade que chegou.')
    if (input.problem && !input.notes?.trim()) throw badRequest('SEM_DESCRICAO', 'Conte o que aconteceu com a entrega.')
    const [r] = await tx
      .insert(deliveryReceipts)
      .values({ companyId, orderId, projectId: o.projectId, items, problem: !!input.problem, notes: input.notes, receivedById: user.id, receivedByName: user.name, receivedAt: when })
      .returning()
    let occurrenceId: string | null = null
    if (input.problem) {
      const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, o.supplierId))
      const [occ] = await tx
        .insert(occurrences)
        .values({
          companyId,
          projectId: o.projectId,
          type: 'ENTREGA',
          severity: 'MEDIA',
          title: `Entrega do pedido ${orderCode(o.number)} com problema`,
          description: `${s?.tradeName ?? s?.name ?? 'Fornecedor'}: ${input.notes}`,
          receiptId: r.id,
          createdById: user.id,
          createdByName: user.name,
          createdAt: when,
        })
        .returning()
      occurrenceId = occ.id
      await raiseAlert(tx, {
        companyId,
        type: 'OCORRENCIA',
        severity: 'ATENCAO',
        fingerprint: `occ:${occ.id}`,
        projectId: o.projectId,
        supplierId: o.supplierId,
        title: occ.title,
        message: `${occ.description} Registrado na obra por ${user.name}.`,
      })
    }
    await audit(tx, { companyId, userId: user.id, entity: 'purchase_order', entityId: orderId, action: 'received_on_site', data: { receiptId: r.id, items, problem: !!input.problem } })
    return { ...r, occurrenceId }
  })
}

export async function createOccurrence(
  companyId: string,
  user: User,
  projectId: string,
  input: { type: (typeof occurrences.$inferInsert)['type']; severity: 'BAIXA' | 'MEDIA' | 'ALTA'; title: string; description?: string | null; happenedAt?: string | null },
) {
  const p = await ownProject(companyId, projectId)
  return db.transaction(async (tx) => {
    const [o] = await tx
      .insert(occurrences)
      .values({
        companyId,
        projectId,
        type: input.type,
        severity: input.severity,
        title: input.title.trim(),
        description: input.description,
        createdById: user.id,
        createdByName: user.name,
        createdAt: happenedAt(input.happenedAt),
      })
      .returning()
    if (input.severity !== 'BAIXA') {
      await raiseAlert(tx, {
        companyId,
        type: 'OCORRENCIA',
        severity: input.severity === 'ALTA' ? 'CRITICO' : 'ATENCAO',
        fingerprint: `occ:${o.id}`,
        projectId,
        title: `${p.name}: ${o.title}`,
        message: `${OCCURRENCE_LABEL[o.type]}${o.description ? ` — ${o.description.trim().replace(/[.\s]+$/, '')}` : ''}. Registrado na obra por ${user.name}.`,
      })
    }
    await audit(tx, { companyId, userId: user.id, entity: 'occurrence', entityId: o.id, action: 'created', data: input })
    return o
  })
}

export async function resolveOccurrence(companyId: string, user: User, id: string, resolution: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx
      .update(occurrences)
      .set({ status: 'RESOLVIDA', resolution, resolvedByName: user.name, resolvedAt: new Date() })
      .where(and(eq(occurrences.companyId, companyId), eq(occurrences.id, id)))
      .returning()
    if (!o) throw notFound('Ocorrência')
    await resolveAlerts(tx, companyId, [`occ:${id}`])
    await audit(tx, { companyId, userId: user.id, entity: 'occurrence', entityId: id, action: 'resolved', data: { resolution } })
    return o
  })
}

/**
 * Atualiza o % da etapa. Se o registro veio da fila do celular e alguém já atualizou a etapa depois,
 * guarda no histórico mas não sobrescreve o valor atual (vale o mais recente).
 */
export async function updateStageProgress(companyId: string, user: User, stageId: string, input: { progress: number; note?: string | null; happenedAt?: string | null }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ s: projectStages })
      .from(projectStages)
      .innerJoin(projects, eq(projects.id, projectStages.projectId))
      .where(and(eq(projectStages.id, stageId), eq(projects.companyId, companyId)))
    if (!row) throw notFound('Etapa')
    const progress = Math.max(0, Math.min(100, Math.round(input.progress)))
    const when = happenedAt(input.happenedAt)
    const applied = !row.s.updatedAt || row.s.updatedAt <= when
    const [u] = await tx
      .insert(stageUpdates)
      .values({ stageId, projectId: row.s.projectId, fromProgress: row.s.progress, progress, note: input.note, userId: user.id, userName: user.name, createdAt: when })
      .returning()
    if (applied) await tx.update(projectStages).set({ progress, updatedAt: when, updatedByName: user.name }).where(eq(projectStages.id, stageId))
    await audit(tx, { companyId, userId: user.id, entity: 'project', entityId: row.s.projectId, action: 'stage_progress', data: { stage: row.s.name, from: row.s.progress, to: progress } })
    return { stageUpdateId: u.id, progress: applied ? progress : row.s.progress, applied }
  })
}

/** Registra uma foto já gravada no disco (a rota cuida do arquivo). */
export async function addSitePhoto(
  companyId: string,
  user: User,
  projectId: string,
  input: { url: string; caption?: string | null; occurrenceId?: string | null; receiptId?: string | null; stageUpdateId?: string | null; happenedAt?: string | null },
) {
  await ownProject(companyId, projectId)
  // o vínculo precisa ser da mesma obra
  if (input.occurrenceId) {
    const [o] = await db.select({ id: occurrences.id }).from(occurrences).where(and(eq(occurrences.id, input.occurrenceId), eq(occurrences.projectId, projectId)))
    if (!o) throw badRequest('VINCULO_INVALIDO', 'Ocorrência não é desta obra.')
  }
  if (input.receiptId) {
    const [r] = await db.select({ id: deliveryReceipts.id }).from(deliveryReceipts).where(and(eq(deliveryReceipts.id, input.receiptId), eq(deliveryReceipts.projectId, projectId)))
    if (!r) throw badRequest('VINCULO_INVALIDO', 'Entrega não é desta obra.')
  }
  if (input.stageUpdateId) {
    const [s] = await db.select({ id: stageUpdates.id }).from(stageUpdates).where(and(eq(stageUpdates.id, input.stageUpdateId), eq(stageUpdates.projectId, projectId)))
    if (!s) throw badRequest('VINCULO_INVALIDO', 'Atualização não é desta obra.')
  }
  const [f] = await db
    .insert(sitePhotos)
    .values({
      companyId,
      projectId,
      url: input.url,
      caption: input.caption,
      occurrenceId: input.occurrenceId,
      receiptId: input.receiptId,
      stageUpdateId: input.stageUpdateId,
      userId: user.id,
      userName: user.name,
      createdAt: happenedAt(input.happenedAt),
    })
    .returning()
  return f
}

// ---------------------------------------------------------------- escritório
/** Define as etapas da obra (mantém o % das que já existiam). */
export async function setStages(companyId: string, userId: string, projectId: string, stages: Array<{ id?: string | null; name: string; weight: number }>) {
  await ownProject(companyId, projectId)
  if (!stages.length) throw badRequest('SEM_ETAPAS', 'Informe ao menos uma etapa.')
  await db.transaction(async (tx) => {
    const current = await tx.select().from(projectStages).where(eq(projectStages.projectId, projectId))
    const keep = new Set(stages.map((s) => s.id).filter(Boolean))
    const removed = current.filter((c) => !keep.has(c.id)).map((c) => c.id)
    if (removed.length) await tx.delete(projectStages).where(inArray(projectStages.id, removed))
    for (const [i, s] of stages.entries()) {
      const name = s.name.trim()
      const weight = Math.max(1, Math.round(s.weight))
      if (s.id && current.some((c) => c.id === s.id)) await tx.update(projectStages).set({ name, weight, sortOrder: i }).where(eq(projectStages.id, s.id))
      else await tx.insert(projectStages).values({ projectId, name, weight, sortOrder: i })
    }
    await audit(tx, { companyId, userId, entity: 'project', entityId: projectId, action: 'stages_updated', data: stages })
  })
  return fieldProject(companyId, projectId)
}

export async function listMaterialRequests(companyId: string, status?: string, scope?: Scope) {
  const rows = await db
    .select({ r: materialRequests, projectName: projects.name, projectCode: projects.code, orderNumber: purchaseOrders.number, orderStatus: purchaseOrders.status })
    .from(materialRequests)
    .innerJoin(projects, eq(projects.id, materialRequests.projectId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, materialRequests.orderId))
    .where(and(eq(materialRequests.companyId, companyId), status ? inArray(materialRequests.status, status.split(',') as any) : undefined, projectInScope(materialRequests.projectId, scope)))
    .orderBy(desc(materialRequests.urgent), desc(materialRequests.createdAt))
    .limit(200)
  return rows.map(({ r, orderNumber, ...x }) => ({ ...r, ...x, orderCode: orderNumber ? orderCode(orderNumber) : null }))
}

export async function declineMaterialRequest(companyId: string, user: User, id: string, reason: string) {
  const [r] = await db
    .update(materialRequests)
    .set({ status: 'RECUSADA', declineReason: reason, handledByName: user.name, handledAt: new Date() })
    .where(and(eq(materialRequests.companyId, companyId), eq(materialRequests.id, id), eq(materialRequests.status, 'ABERTA')))
    .returning()
  if (!r) throw conflict('STATUS_INVALIDO', 'Esta solicitação já foi tratada.')
  await audit(db, { companyId, userId: user.id, entity: 'material_request', entityId: id, action: 'declined', data: { reason } })
  return r
}

/** Recebimentos na obra de um pedido (para a tela de Compras e a conferência da nota). */
export async function orderReceipts(orderId: string) {
  const rows = await db.select().from(deliveryReceipts).where(eq(deliveryReceipts.orderId, orderId)).orderBy(deliveryReceipts.receivedAt)
  const photos = rows.length ? await db.select().from(sitePhotos).where(inArray(sitePhotos.receiptId, rows.map((r) => r.id))) : []
  return rows.map((r) => ({
    id: r.id,
    items: r.items,
    problem: r.problem,
    notes: r.notes,
    receivedAt: r.receivedAt,
    receivedByName: r.receivedByName,
    photos: photos.filter((p) => p.receiptId === r.id).map((p) => p.url),
  }))
}
