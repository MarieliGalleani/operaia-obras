/**
 * Fila do celular (app de obra sem internet).
 *
 * Cada registro do mestre vira um item com id próprio, que também é a Idempotency-Key:
 * se a internet cair no meio do envio e o celular reenviar, a API devolve a mesma resposta sem duplicar.
 *
 * - Itens saem na ordem em que foram feitos.
 * - Um item pode depender de outro (foto de uma ocorrência feita sem internet): espera o "pai" ir primeiro
 *   e usa o id que o servidor devolveu para ele.
 * - Sem internet (ou servidor fora): para e tenta de novo depois. Erro de validação: marca o item com o
 *   motivo e segue com os outros; o mestre pode descartar.
 *
 * A lógica não conhece IndexedDB nem fetch: recebe um Store e um Sender (assim dá para testar).
 */

export type OutboxKind = 'request' | 'receive' | 'occurrence' | 'resolve' | 'stage' | 'photo'

export interface OutboxItem {
  /** id local; também é a Idempotency-Key */
  id: string
  userId: string
  projectId: string
  kind: OutboxKind
  /** texto para a lista "na fila" */
  label: string
  url: string
  body?: Record<string, unknown>
  /** foto guardada no aparelho */
  blobId?: string
  /** campo do body → id local do item do qual depende (recebe o id do servidor) */
  refs?: Record<string, string>
  /** id local do item cujo id do servidor entra no lugar de {ref} na url */
  urlRef?: string
  happenedAt: string
  createdAt: number
  status: 'PENDENTE' | 'ERRO'
  error?: string
  attempts: number
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>
  put(item: OutboxItem): Promise<void>
  delete(id: string): Promise<void>
  getBlob(id: string): Promise<Blob | undefined>
  putBlob(id: string, blob: Blob): Promise<void>
  deleteBlob(id: string): Promise<void>
  getRef(localId: string): Promise<string | undefined>
  putRef(localId: string, serverId: string): Promise<void>
}

export type SendResult =
  | { ok: true; data: unknown }
  /** sem internet, servidor fora ou login vencido: tenta de novo depois */
  | { ok: false; retry: true }
  | { ok: false; retry: false; status: number; message: string }

export type Sender = (item: OutboxItem, url: string, body: Record<string, unknown>, blob?: Blob) => Promise<SendResult>

export type ProcessResult = { kind: 'ok'; data: unknown } | { kind: 'retry' } | { kind: 'blocked' } | { kind: 'error'; status: number; message: string }

/** Id que o servidor devolve e que outros itens podem precisar (ocorrência, recebimento, avanço). */
function serverIdOf(data: unknown): string | undefined {
  const d = data as Record<string, unknown> | null
  const id = d?.stageUpdateId ?? d?.id
  return typeof id === 'string' ? id : undefined
}

export function createOutbox(store: OutboxStore, send: Sender) {
  async function resolveRef(localId: string, items: OutboxItem[]): Promise<string | 'blocked' | 'failed'> {
    const serverId = await store.getRef(localId)
    if (serverId) return serverId
    const parent = items.find((i) => i.id === localId)
    // pai ainda na fila: espera; pai com erro (ou sumiu sem id): não dá para ligar
    return parent && parent.status === 'PENDENTE' ? 'blocked' : 'failed'
  }

  async function fail(item: OutboxItem, status: number, message: string): Promise<ProcessResult> {
    await store.put({ ...item, status: 'ERRO', error: message, attempts: item.attempts + 1 })
    return { kind: 'error', status, message }
  }

  async function processOne(item: OutboxItem, items?: OutboxItem[]): Promise<ProcessResult> {
    const all = items ?? (await store.all())
    const body: Record<string, unknown> = { ...(item.body ?? {}) }
    for (const [field, localId] of Object.entries(item.refs ?? {})) {
      const r = await resolveRef(localId, all)
      if (r === 'blocked') return { kind: 'blocked' }
      if (r === 'failed') return fail(item, 0, 'O registro ligado a este não foi enviado.')
      body[field] = r
    }
    let url = item.url
    if (item.urlRef) {
      const r = await resolveRef(item.urlRef, all)
      if (r === 'blocked') return { kind: 'blocked' }
      if (r === 'failed') return fail(item, 0, 'O registro ligado a este não foi enviado.')
      url = url.replace('{ref}', r)
    }
    const blob = item.blobId ? await store.getBlob(item.blobId) : undefined
    if (item.blobId && !blob) return fail(item, 0, 'A foto não está mais no aparelho.')

    const res = await send(item, url, body, blob)
    if (res.ok) {
      const sid = serverIdOf(res.data)
      if (sid) await store.putRef(item.id, sid)
      await store.delete(item.id)
      if (item.blobId) await store.deleteBlob(item.blobId)
      return { kind: 'ok', data: res.data }
    }
    if (res.retry) return { kind: 'retry' }
    return fail(item, res.status, res.message)
  }

  /** Envia o que está pendente deste usuário, na ordem. Para no primeiro "sem internet". */
  async function sync(userId: string) {
    const out = { sent: 0, failed: 0, stoppedOffline: false }
    // várias passadas: um item liberado (pai enviado) pode destravar o próximo
    for (let pass = 0; pass < 5; pass++) {
      const items = (await store.all()).filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt)
      const pending = items.filter((i) => i.status === 'PENDENTE')
      if (!pending.length) break
      let progressed = false
      for (const item of pending) {
        const r = await processOne(item, await store.all())
        if (r.kind === 'ok') {
          out.sent++
          progressed = true
        } else if (r.kind === 'error') {
          out.failed++
          progressed = true
        } else if (r.kind === 'retry') {
          out.stoppedOffline = true
          return out
        }
      }
      if (!progressed) break
    }
    return out
  }

  async function discard(id: string) {
    const item = (await store.all()).find((i) => i.id === id)
    if (!item) return
    await store.delete(id)
    if (item.blobId) await store.deleteBlob(item.blobId)
  }

  /** Tenta de novo um item com erro (ex.: depois de corrigir algo no escritório). */
  async function retry(id: string) {
    const item = (await store.all()).find((i) => i.id === id)
    if (item) await store.put({ ...item, status: 'PENDENTE', error: undefined })
  }

  return { processOne, sync, discard, retry, store }
}

export function newId() {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  // celulares antigos sem randomUUID
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
