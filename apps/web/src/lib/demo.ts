/**
 * Modo demonstração (build com VITE_DEMO=1): o front lê um retrato fixo das respostas da API.
 * Navegação e filtros funcionam; ações que gravam ficam desativadas.
 */
export const DEMO = import.meta.env.VITE_DEMO === '1'

let cache: Promise<Record<string, unknown>> | null = null
function load() {
  cache ??= fetch(new URL('./demo-data.json', document.baseURI)).then((r) => r.json()).then((j) => j.responses)
  return cache
}

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export async function demoGet(rawUrl: string): Promise<unknown> {
  const data = await load()
  const url = decodeURIComponent(rawUrl)
  if (url in data) return structuredClone(data[url])
  const [path, query = ''] = url.split('?')
  const key = (p: URLSearchParams) => decodeURIComponent(p.toString())
  const params = new URLSearchParams(query)

  if (path === '/api/documents') {
    const q = norm(params.get('q'))
    params.delete('q')
    const base = (data[`${path}?${key(params)}`] ?? data['/api/documents?'] ?? []) as Record<string, unknown>[]
    return q ? base.filter((d) => [d.number, d.supplierName, d.description].some((v) => norm(v).includes(q))) : structuredClone(base)
  }
  if (path === '/api/suppliers') {
    const q = norm(params.get('q'))
    const cat = params.get('category')
    const base = (data['/api/suppliers?'] ?? []) as Record<string, unknown>[]
    return base.filter((s) => (!cat || s.defaultCategory === cat) && (!q || norm(s.name).includes(q) || String(s.cnpj).includes(q)))
  }
  if (path === '/api/dashboard') {
    // período sem retrato: usa o mês atual
    const key = Object.keys(data).find((k) => k.startsWith('/api/dashboard'))
    if (key) return structuredClone(data[key])
  }
  if (path in data) return structuredClone(data[path])
  throw Object.assign(new Error('Dado não disponível na demonstração.'), { status: 404 })
}

export const DEMO_BLOCKED = 'Na demonstração as ações que gravam dados ficam desativadas. Rode o projeto para usar de verdade.'
