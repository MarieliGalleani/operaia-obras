import { DEMO, DEMO_BLOCKED, demoGet } from './demo'

const TOKEN_KEY = 'operaia-obras:token'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* navegação privada */
  }
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn)

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (DEMO) {
    if (method === 'GET') {
      try {
        return (await demoGet(url)) as T
      } catch (e) {
        throw new ApiError(404, 'DEMO', (e as Error).message)
      }
    }
    throw new ApiError(403, 'DEMO', DEMO_BLOCKED)
  }
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(url, { method, headers, body: payload })
  if (res.status === 401 && !url.endsWith('/auth/login')) onUnauthorized?.()
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERRO', data?.message ?? 'Erro inesperado', data?.details)
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  /** Baixa um arquivo autenticado (CSV etc.) */
  async download(url: string, fallbackName: string) {
    if (DEMO) throw new ApiError(403, 'DEMO', 'Exportações ficam desativadas na demonstração.')
    const res = await fetch(url, { headers: { authorization: `Bearer ${getToken()}` } })
    if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD', 'Não foi possível gerar o arquivo')
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await res.blob())
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  },
  /** URL autenticada para abrir arquivo em nova aba */
  async openFile(url: string) {
    if (DEMO) throw new ApiError(403, 'DEMO', 'Os arquivos originais não acompanham a demonstração.')
    const res = await fetch(url, { headers: { authorization: `Bearer ${getToken()}` } })
    if (!res.ok) throw new ApiError(res.status, 'ARQUIVO', 'Não foi possível abrir o arquivo')
    const blob = await res.blob()
    window.open(URL.createObjectURL(blob), '_blank')
  },
}
