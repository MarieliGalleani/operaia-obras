/**
 * App de obra sem internet — ligação da fila com o navegador.
 *
 * - IndexedDB guarda: a última resposta de cada tela da obra, a fila de registros e as fotos.
 * - `cachedGet`: busca na API; sem internet, devolve a última cópia guardada (com a hora dela).
 * - `submit`: põe o registro na fila e já tenta enviar. Com internet o mestre vê o resultado na hora;
 *   sem internet fica guardado e sai sozinho quando o sinal voltar.
 */
import { reactive } from 'vue'
import { ApiError, api, getToken } from './api'
import { createOutbox, newId, type OutboxItem, type OutboxStore, type SendResult } from './outbox'

const DB_NAME = 'operaia-obras'
const STORES = ['cache', 'outbox', 'blobs', 'refs'] as const
type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null
function openDb() {
  dbPromise ??= new Promise((ok, fail) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => ok(req.result)
    req.onerror = () => fail(req.error)
  })
  return dbPromise
}
async function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((ok, fail) => {
    const t = db.transaction(store, mode)
    const r = run(t.objectStore(store))
    t.oncomplete = () => ok(r.result)
    t.onerror = () => fail(t.error)
    t.onabort = () => fail(t.error)
  })
}
const idb = {
  get: <T>(s: StoreName, k: string) => tx<T | undefined>(s, 'readonly', (o) => o.get(k) as IDBRequest<T | undefined>),
  put: (s: StoreName, k: string, v: unknown) => tx(s, 'readwrite', (o) => o.put(v, k)).then(() => undefined),
  del: (s: StoreName, k: string) => tx(s, 'readwrite', (o) => o.delete(k)).then(() => undefined),
  all: <T>(s: StoreName) => tx<T[]>(s, 'readonly', (o) => o.getAll() as IDBRequest<T[]>),
  clear: (s: StoreName) => tx(s, 'readwrite', (o) => o.clear()).then(() => undefined),
}

const store: OutboxStore = {
  all: () => idb.all<OutboxItem>('outbox'),
  put: (i) => idb.put('outbox', i.id, i),
  delete: (id) => idb.del('outbox', id),
  getBlob: (id) => idb.get<Blob>('blobs', id),
  putBlob: (id, b) => idb.put('blobs', id, b),
  deleteBlob: (id) => idb.del('blobs', id),
  getRef: (id) => idb.get<string>('refs', id),
  putRef: (id, sid) => idb.put('refs', id, sid),
}

// ------------------------------------------------------------ estado na tela
export const net = reactive({ online: typeof navigator === 'undefined' ? true : navigator.onLine })
export const queue = reactive({ items: [] as OutboxItem[], syncing: false, lastSyncAt: 0, lastSent: 0 })

function setOnline(v: boolean) {
  net.online = v
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setOnline(true)
    void syncNow()
  })
  window.addEventListener('offline', () => setOnline(false))
}

let currentUser: string | null = null
export function setOfflineUser(userId: string | null) {
  currentUser = userId
  void refreshQueue()
}
export async function refreshQueue() {
  try {
    queue.items = currentUser ? (await store.all()).filter((i) => i.userId === currentUser).sort((a, b) => a.createdAt - b.createdAt) : []
  } catch {
    queue.items = []
  }
}

// ------------------------------------------------------------ envio
const sender = async (item: OutboxItem, url: string, body: Record<string, unknown>, blob?: Blob): Promise<SendResult> => {
  const headers: Record<string, string> = { 'idempotency-key': item.id }
  const token = getToken()
  if (token) headers.authorization = `Bearer ${token}`
  let payload: BodyInit
  if (blob) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(body)) if (v != null && v !== '') fd.append(k, String(v))
    fd.append('happenedAt', item.happenedAt)
    fd.append('file', blob, 'foto.jpg')
    payload = fd
  } else {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify({ ...body, happenedAt: item.happenedAt })
  }
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: payload })
  } catch {
    setOnline(false)
    return { ok: false, retry: true }
  }
  setOnline(true)
  // servidor fora do ar ou login vencido: guarda e tenta depois
  if (res.status >= 500 || res.status === 401) return { ok: false, retry: true }
  const text = await res.text()
  let data: { message?: string } | null = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* resposta sem JSON */
  }
  if (!res.ok) return { ok: false, retry: false, status: res.status, message: data?.message ?? 'Não foi aceito pelo sistema.' }
  return { ok: true, data }
}

const outbox = createOutbox(store, sender)

let syncing: Promise<void> | null = null
/** Envia a fila agora (não roda duas vezes ao mesmo tempo). */
export function syncNow() {
  if (!currentUser) return Promise.resolve()
  syncing ??= (async () => {
    queue.syncing = true
    try {
      const r = await outbox.sync(currentUser!)
      if (r.sent) {
        queue.lastSent = r.sent
        queue.lastSyncAt = Date.now()
      }
    } catch {
      /* tenta de novo no próximo ciclo */
    } finally {
      queue.syncing = false
      syncing = null
      await refreshQueue()
    }
  })()
  return syncing
}

let timer: ReturnType<typeof setInterval> | null = null
/** Tenta enviar a fila a cada 20 s enquanto houver pendências. */
export function startBackgroundSync() {
  if (timer) return
  timer = setInterval(() => {
    if (queue.items.some((i) => i.status === 'PENDENTE')) void syncNow()
  }, 20_000)
  void syncNow()
}

export interface SubmitInput {
  projectId: string
  kind: OutboxItem['kind']
  label: string
  url: string
  body?: Record<string, unknown>
  photo?: Blob
  refs?: Record<string, string>
  urlRef?: string
}
export type SubmitResult = { sent: true; data: any; localId: string } | { sent: false; localId: string }

/**
 * Registra uma ação do app de obra. Tenta enviar na hora; sem internet guarda na fila.
 * Erro de validação com internet: devolve o erro (o mestre corrige na própria tela) e não deixa na fila.
 */
export async function submit(input: SubmitInput): Promise<SubmitResult> {
  if (!currentUser) throw new ApiError(401, 'SEM_LOGIN', 'Faça login novamente.')
  const id = newId()
  const item: OutboxItem = {
    id,
    userId: currentUser,
    projectId: input.projectId,
    kind: input.kind,
    label: input.label,
    url: input.url,
    body: input.body,
    refs: input.refs,
    urlRef: input.urlRef,
    happenedAt: new Date().toISOString(),
    createdAt: Date.now(),
    status: 'PENDENTE',
    attempts: 0,
  }
  if (input.photo) {
    item.blobId = id
    await store.putBlob(id, input.photo)
  }
  await store.put(item)
  try {
    // com outros itens na fila, este espera a vez (a ordem importa)
    const ahead = (await store.all()).some((i) => i.userId === currentUser && i.status === 'PENDENTE' && i.id !== id)
    if (!ahead || !net.online) {
      if (!net.online) return { sent: false, localId: id }
      const r = await outbox.processOne(item)
      if (r.kind === 'ok') return { sent: true, data: r.data, localId: id }
      if (r.kind === 'error' && r.status) {
        await outbox.discard(id)
        throw new ApiError(r.status, 'RECUSADO', r.message)
      }
      return { sent: false, localId: id }
    }
    void syncNow()
    return { sent: false, localId: id }
  } finally {
    await refreshQueue()
  }
}

export async function discardItem(id: string) {
  await outbox.discard(id)
  await refreshQueue()
}
export async function retryItem(id: string) {
  await outbox.retry(id)
  await refreshQueue()
  await syncNow()
}

// ------------------------------------------------------------ leitura com cópia guardada
export interface Cached<T> {
  data: T
  /** quando a cópia foi baixada */
  at: number
  offline: boolean
}
export async function cachedGet<T>(url: string): Promise<Cached<T>> {
  const key = `${currentUser ?? 'anon'}:${url}`
  try {
    const data = await api.get<T>(url)
    setOnline(true)
    idb.put('cache', key, { data, at: Date.now() }).catch(() => {})
    return { data, at: Date.now(), offline: false }
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 0) throw e
    setOnline(false)
    const hit = await idb.get<{ data: T; at: number }>('cache', key).catch(() => undefined)
    if (!hit) throw new ApiError(0, 'SEM_INTERNET', 'Sem internet e esta tela ainda não foi aberta neste celular com sinal.')
    return { data: hit.data, at: hit.at, offline: true }
  }
}
/** Atualiza a cópia guardada (ex.: avanço registrado sem internet aparece já na tela). */
export async function patchCache<T>(url: string, fn: (d: T) => T) {
  const key = `${currentUser ?? 'anon'}:${url}`
  const hit = await idb.get<{ data: T; at: number }>('cache', key).catch(() => undefined)
  if (hit) await idb.put('cache', key, { data: fn(hit.data), at: hit.at }).catch(() => {})
}

/** Ao sair: apaga as cópias das telas (dados da construtora) deste aparelho. A fila fica, por usuário. */
export async function clearOfflineCache() {
  await idb.clear('cache').catch(() => {})
}
