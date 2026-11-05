/**
 * Onde ficam os arquivos (XML e PDF das notas, fotos das obras e do canteiro).
 *
 * - STORAGE_DRIVER=local (padrão): pasta STORAGE_DIR no próprio servidor.
 * - STORAGE_DRIVER=s3: qualquer armazenamento compatível com S3 (Cloudflare R2, Backblaze B2,
 *   AWS S3, MinIO). Bucket privado: os arquivos passam sempre pela API, que confere login e liberações.
 *
 * A "chave" de um arquivo é o caminho relativo dentro do armazenamento, igual nos dois modos:
 *   <companyId>/<AAAA-MM>/<hash>-<nome>   notas
 *   media/obras/<aleatório>.<ext>          fotos
 * Assim trocar de local para S3 é só copiar os arquivos (`node dist/cli/admin.js copiar-arquivos-s3`).
 */
import { createHash, createHmac } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface Storage {
  readonly kind: 'local' | 's3'
  put(key: string, content: Buffer, contentType?: string): Promise<void>
  /** null quando o arquivo não existe */
  get(key: string): Promise<Buffer | null>
  exists(key: string): Promise<boolean>
  /** bytes do arquivo; null quando não existe */
  size(key: string): Promise<number | null>
  delete(key: string): Promise<void>
}

/** Chave segura: sem "..", sem barra no começo; valores antigos com o caminho da pasta viram chave. */
export function toKey(pathOrKey: string): string {
  let k = pathOrKey.replace(/\\/g, '/')
  // valores antigos gravados como "./storage/<id>/..." ou "/app/storage/<id>/..."
  const m = /^(?:.*\/)?storage\/(.+)$/.exec(k)
  if (m) k = m[1]
  k = k.replace(/^\.?\/+/, '')
  if (!k || k.split('/').some((p) => p === '..' || p === '.' || p === '')) throw new Error(`chave de arquivo inválida: ${pathOrKey}`)
  return k
}

export const contentTypeOf = (name: string) => {
  const n = name.toLowerCase()
  if (n.endsWith('.xml')) return 'application/xml'
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (/\.jpe?g$/.test(n)) return 'image/jpeg'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

// ------------------------------------------------------------------ disco local

export function diskStorage(dir: string): Storage {
  const full = (key: string) => path.join(dir, toKey(key))
  return {
    kind: 'local',
    async put(key, content) {
      const f = full(key)
      await mkdir(path.dirname(f), { recursive: true })
      await writeFile(f, content)
    },
    async get(key) {
      try {
        return await readFile(full(key))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async exists(key) {
      return stat(full(key)).then(
        () => true,
        () => false,
      )
    },
    async size(key) {
      return stat(full(key)).then(
        (s) => s.size,
        () => null,
      )
    },
    async delete(key) {
      await unlink(full(key)).catch(() => {})
    },
  }
}

/** Todas as chaves da pasta local (para copiar para o S3). */
export async function listLocalKeys(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(rel: string) {
    let entries
    try {
      entries = await readdir(path.join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else if (e.isFile() && !e.name.startsWith('.')) out.push(r)
    }
  }
  await walk('')
  return out.sort()
}

// ------------------------------------------------------------------ S3 (assinatura AWS v4, sem SDK)

export interface S3Config {
  endpoint: string // ex.: https://<conta>.r2.cloudflarestorage.com
  region: string // R2: "auto"
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** endpoint/bucket/chave (R2, MinIO, B2) em vez de bucket.endpoint/chave */
  pathStyle: boolean
}

const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex')
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest()
/** Codificação de URI do S3: tudo menos A-Z a-z 0-9 - _ . ~ (e "/" no caminho). */
export const s3Encode = (s: string, keepSlash = true) =>
  encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /$^/, '/')

/**
 * Assinatura AWS Signature Version 4 (cabeçalho Authorization).
 * Exportada para o teste conferir com o exemplo oficial da AWS.
 */
export function signV4(p: {
  method: string
  host: string
  path: string // já codificado
  query?: string // já canônica
  headers: Record<string, string> // sem host; inclui x-amz-date e x-amz-content-sha256
  payloadHash: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  service?: string
}) {
  const service = p.service ?? 's3'
  const amzDate = p.headers['x-amz-date']
  const day = amzDate.slice(0, 8)
  const all: Record<string, string> = { host: p.host }
  for (const [k, v] of Object.entries(p.headers)) all[k.toLowerCase()] = String(v).trim()
  const names = Object.keys(all).sort()
  const canonical = [p.method, p.path, p.query ?? '', names.map((n) => `${n}:${all[n]}\n`).join(''), names.join(';'), p.payloadHash].join('\n')
  const scope = `${day}/${p.region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const kDate = hmac(`AWS4${p.secretAccessKey}`, day)
  const kSigning = hmac(hmac(hmac(kDate, p.region), service), 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex')
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    signature,
  }
}

export function s3Storage(cfg: S3Config): Storage {
  const base = new URL(cfg.endpoint)
  const target = (key: string) => {
    const k = s3Encode(toKey(key))
    return cfg.pathStyle
      ? { host: base.host, path: `${base.pathname.replace(/\/$/, '')}/${s3Encode(cfg.bucket)}/${k}` }
      : { host: `${cfg.bucket}.${base.host}`, path: `${base.pathname.replace(/\/$/, '')}/${k}` }
  }
  async function send(method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', key: string, body?: Buffer, contentType?: string) {
    const { host, path: p } = target(key)
    const payloadHash = body ? sha256(body) : sha256('')
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const headers: Record<string, string> = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    if (body && contentType) headers['content-type'] = contentType
    const { authorization } = signV4({ method, host, path: p, headers, payloadHash, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey })
    let last: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${base.protocol}//${host}${p}`, {
          method,
          headers: { ...headers, authorization },
          body: body ? new Uint8Array(body) : undefined,
          signal: AbortSignal.timeout(60_000),
        })
        if (res.status >= 500) {
          last = new Error(`S3 ${method} ${res.status}`)
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
          continue
        }
        return res
      } catch (e) {
        last = e
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      }
    }
    throw new Error(`Armazenamento de arquivos indisponível (${String((last as Error)?.message ?? last)})`)
  }
  const fail = async (res: Response, what: string) => {
    const text = await res.text().catch(() => '')
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? res.status
    throw new Error(`S3 ${what}: ${code}`)
  }
  return {
    kind: 's3',
    async put(key, content, contentType) {
      const res = await send('PUT', key, content, contentType ?? contentTypeOf(key))
      if (!res.ok) await fail(res, 'gravar')
    },
    async get(key) {
      const res = await send('GET', key)
      if (res.status === 404) return null
      if (!res.ok) await fail(res, 'ler')
      return Buffer.from(await res.arrayBuffer())
    },
    async exists(key) {
      const res = await send('HEAD', key)
      if (res.status === 404) return false
      if (!res.ok) await fail(res, 'conferir')
      return true
    },
    async size(key) {
      const res = await send('HEAD', key)
      if (res.status === 404) return null
      if (!res.ok) await fail(res, 'conferir')
      return Number(res.headers.get('content-length') ?? 0)
    },
    async delete(key) {
      const res = await send('DELETE', key)
      if (!res.ok && res.status !== 404) await fail(res, 'apagar')
    },
  }
}

// ------------------------------------------------------------------ configuração

export function s3ConfigFromEnv(env = process.env): S3Config | null {
  if (!env.S3_BUCKET) return null
  const missing = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k])
  if (missing.length) throw new Error(`Faltam variáveis do S3: ${missing.join(', ')}`)
  return {
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION || 'auto',
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    pathStyle: (env.S3_PATH_STYLE ?? 'true') !== 'false',
  }
}

export const STORAGE_DIR = process.env.STORAGE_DIR ?? './storage'

let current: Storage | null = null
export function storage(): Storage {
  if (!current) {
    const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase()
    if (driver === 's3') {
      const cfg = s3ConfigFromEnv()
      if (!cfg) throw new Error('STORAGE_DRIVER=s3 precisa de S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY')
      current = s3Storage(cfg)
    } else current = diskStorage(STORAGE_DIR)
  }
  return current
}
/** Só para testes. */
export const setStorage = (s: Storage | null) => (current = s)
