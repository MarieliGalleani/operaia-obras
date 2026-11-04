import { describe, expect, it } from 'vitest'
import { createOutbox, type OutboxItem, type OutboxStore, type SendResult } from './outbox'

function memoryStore(): OutboxStore & { items: Map<string, OutboxItem>; refs: Map<string, string>; blobs: Map<string, Blob> } {
  const items = new Map<string, OutboxItem>()
  const refs = new Map<string, string>()
  const blobs = new Map<string, Blob>()
  return {
    items,
    refs,
    blobs,
    all: async () => [...items.values()],
    put: async (i) => void items.set(i.id, structuredClone(i)),
    delete: async (id) => void items.delete(id),
    getBlob: async (id) => blobs.get(id),
    putBlob: async (id, b) => void blobs.set(id, b),
    deleteBlob: async (id) => void blobs.delete(id),
    getRef: async (id) => refs.get(id),
    putRef: async (id, s) => void refs.set(id, s),
  }
}
let t = 0
const item = (id: string, over: Partial<OutboxItem> = {}): OutboxItem => ({
  id,
  userId: 'u1',
  projectId: 'p1',
  kind: 'occurrence',
  label: id,
  url: '/api/field/projects/p1/occurrences',
  body: {},
  happenedAt: new Date().toISOString(),
  createdAt: ++t,
  status: 'PENDENTE',
  attempts: 0,
  ...over,
})

describe('fila do app de obra', () => {
  it('envia na ordem e liga a foto ao id que o servidor devolveu para a ocorrência', async () => {
    const store = memoryStore()
    const calls: Array<{ id: string; url: string; body: Record<string, unknown> }> = []
    const send = async (i: OutboxItem, url: string, body: Record<string, unknown>): Promise<SendResult> => {
      calls.push({ id: i.id, url, body })
      return { ok: true, data: { id: `srv-${i.id}` } }
    }
    const ob = createOutbox(store, send)
    await store.put(item('occ'))
    await store.putBlob('ph', new Blob(['x']))
    await store.put(item('ph', { kind: 'photo', url: '/api/field/projects/p1/photos', blobId: 'ph', refs: { occurrenceId: 'occ' } }))
    await store.put(item('res', { kind: 'resolve', url: '/api/field/occurrences/{ref}/resolve', urlRef: 'occ' }))
    const r = await ob.sync('u1')
    expect(r).toEqual({ sent: 3, failed: 0, stoppedOffline: false })
    expect(calls.map((c) => c.id)).toEqual(['occ', 'ph', 'res'])
    expect(calls[1].body.occurrenceId).toBe('srv-occ')
    expect(calls[2].url).toBe('/api/field/occurrences/srv-occ/resolve')
    expect(store.items.size).toBe(0)
    expect(store.blobs.size).toBe(0)
  })

  it('sem internet para tudo e mantém a fila; quando volta, envia', async () => {
    const store = memoryStore()
    let online = false
    const ob = createOutbox(store, async (i) => (online ? { ok: true, data: { id: i.id } } : { ok: false, retry: true }))
    await store.put(item('a'))
    await store.put(item('b'))
    expect((await ob.sync('u1')).stoppedOffline).toBe(true)
    expect(store.items.size).toBe(2)
    online = true
    expect((await ob.sync('u1')).sent).toBe(2)
  })

  it('erro de validação marca o item e segue; dependente do item com erro também falha', async () => {
    const store = memoryStore()
    const ob = createOutbox(store, async (i) => (i.id === 'bad' ? { ok: false, retry: false, status: 409, message: 'Pedido fechado' } : { ok: true, data: { id: i.id } }))
    await store.put(item('bad', { kind: 'receive' }))
    await store.put(item('ph', { kind: 'photo', refs: { receiptId: 'bad' } }))
    await store.put(item('ok'))
    const r = await ob.sync('u1')
    expect(r.sent).toBe(1)
    expect(r.failed).toBe(2)
    expect(store.items.get('bad')?.error).toBe('Pedido fechado')
    expect(store.items.get('ph')?.status).toBe('ERRO')
    await ob.discard('bad')
    expect(store.items.has('bad')).toBe(false)
  })

  it('só envia a fila do usuário logado', async () => {
    const store = memoryStore()
    const sent: string[] = []
    const ob = createOutbox(store, async (i) => (sent.push(i.id), { ok: true, data: {} }))
    await store.put(item('meu'))
    await store.put(item('outro', { userId: 'u2' }))
    await ob.sync('u1')
    expect(sent).toEqual(['meu'])
    expect(store.items.has('outro')).toBe(true)
  })
})
