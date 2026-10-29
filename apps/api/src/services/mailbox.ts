/**
 * E-mail de notas: o sistema lê a caixa IMAP de cada construtora e importa os XMLs anexados.
 * - Senha guardada com AES-256-GCM (chave derivada de ENCRYPTION_KEY ou JWT_SECRET).
 * - Lê só mensagens não lidas e marca como lidas depois de processar.
 * - Erros viram mensagens em português que a construtora entende.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser, type Attachment } from 'mailparser'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { companies, mailInboxes } from '../db/schema.js'
import { audit } from './audit.js'
import { ingestNfeXml } from './documents.js'
import { badRequest, notFound } from './errors.js'

// ------------------------------------------------------------------ cripto
function key() {
  const base = process.env.ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? 'dev-secret'
  return createHash('sha256').update(`operaia-obras:mail:${base}`).digest()
}
export function encrypt(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}
export function decrypt(payload: string) {
  const [v, iv, tag, data] = payload.split(':')
  if (v !== 'v1') throw new Error('formato de senha desconhecido')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

// ------------------------------------------------------------------ presets
export const PROVIDERS = [
  { id: 'gmail', name: 'Gmail / Google Workspace', host: 'imap.gmail.com', port: 993, secure: true, help: 'Use uma senha de app (Conta Google → Segurança → Verificação em duas etapas → Senhas de app).' },
  { id: 'outlook', name: 'Outlook / Microsoft 365', host: 'outlook.office365.com', port: 993, secure: true, help: 'Algumas contas Microsoft 365 bloqueiam IMAP com senha. Se falhar, prefira um Gmail só para notas.' },
  { id: 'hostinger', name: 'Hostinger', host: 'imap.hostinger.com', port: 993, secure: true, help: 'Use o e-mail completo e a senha da caixa.' },
  { id: 'locaweb', name: 'Locaweb', host: 'email-ssl.com.br', port: 993, secure: true, help: 'Use o e-mail completo e a senha da caixa.' },
  { id: 'zoho', name: 'Zoho Mail', host: 'imap.zoho.com', port: 993, secure: true, help: 'Ative o acesso IMAP nas configurações do Zoho.' },
] as const

// ------------------------------------------------------------------ erros
export function friendlyMailError(e: unknown): string {
  const err = e as { code?: string; authenticationFailed?: boolean; responseText?: string; message?: string; serverResponseCode?: string }
  const text = `${err.responseText ?? ''} ${err.message ?? ''}`.toLowerCase()
  if (err.authenticationFailed || err.serverResponseCode === 'AUTHENTICATIONFAILED' || /auth|login|credential|password|senha/.test(text)) {
    return 'Usuário ou senha recusados pelo servidor de e-mail. No Gmail, use uma senha de app (não a senha normal).'
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'Servidor de e-mail não encontrado. Confira o endereço do servidor (ex.: imap.gmail.com).'
  if (err.code === 'ECONNREFUSED') return 'O servidor recusou a conexão. Confira a porta (normalmente 993) e se o IMAP está ativado na conta.'
  if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT' || /timeout|timed out/.test(text)) return 'O servidor não respondeu a tempo. Confira o endereço e a porta.'
  if (/certificate|ssl|tls/.test(text)) return 'Problema de segurança na conexão (SSL). Confira se a porta 993 com SSL está correta.'
  if (/mailbox|nonexistent|no such/.test(text)) return 'A pasta informada não existe nessa caixa. Use INBOX.'
  if (/decrypt|unsupported state|formato de senha/.test(text)) return 'A senha guardada não pôde ser lida. Informe a senha da caixa de novo.'
  return `Não foi possível ler a caixa de e-mail (${err.message ?? 'erro desconhecido'}).`
}

interface Conn {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  mailbox: string
}

function client(c: Conn) {
  return new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.username, pass: c.password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 60000,
    // servidores de teste locais usam certificado próprio
    tls: { rejectUnauthorized: !['127.0.0.1', 'localhost'].includes(c.host) },
  })
}

/** Conecta, abre a pasta e diz quantas mensagens não lidas há. Não altera nada. */
export async function testConnection(c: Conn) {
  const imap = client(c)
  imap.on('error', () => {})
  try {
    await imap.connect()
    const status = await imap.status(c.mailbox, { messages: true, unseen: true })
    if (!status) throw new Error('no such mailbox')
    return { ok: true as const, messages: status.messages ?? 0, unseen: status.unseen ?? 0 }
  } finally {
    await imap.logout().catch(() => imap.close())
  }
}

export function xmlAttachments(attachments: Attachment[]) {
  return attachments.filter((a) => {
    const name = (a.filename ?? '').toLowerCase()
    const type = (a.contentType ?? '').toLowerCase()
    return name.endsWith('.xml') || type.includes('xml')
  })
}

/** Processa uma mensagem bruta (RFC 822): importa cada XML anexado como NF-e. */
export async function processRawMessage(companyId: string, raw: Buffer) {
  const mail = await simpleParser(raw)
  const results: { fileName: string; status: string; documentId?: string; message?: string }[] = []
  for (const att of xmlAttachments(mail.attachments)) {
    const fileName = att.filename ?? 'nfe.xml'
    try {
      const r = await ingestNfeXml({ companyId, fileName, content: att.content, source: 'EMAIL' })
      results.push({ fileName, status: r.status, documentId: r.documentId })
    } catch (e) {
      results.push({ fileName, status: 'ERRO', message: (e as Error).message })
    }
  }
  return { subject: mail.subject ?? '', from: mail.from?.text ?? '', results }
}

const running = new Set<string>()

/** Lê as mensagens não lidas de uma construtora. Seguro contra execuções simultâneas. */
export async function checkInbox(companyId: string, opts: { maxMessages?: number } = {}) {
  if (running.has(companyId)) return { skipped: true as const }
  const inbox = await db.query.mailInboxes.findFirst({ where: eq(mailInboxes.companyId, companyId) })
  if (!inbox) throw notFound('Caixa de e-mail')
  running.add(companyId)
  const startedAt = new Date()
  let messages = 0
  let created = 0
  let duplicates = 0
  let errors = 0
  try {
    const imap = client({ ...inbox, password: decrypt(inbox.passwordEnc) })
    imap.on('error', () => {})
    await imap.connect()
    try {
      const lock = await imap.getMailboxLock(inbox.mailbox)
      try {
        const uids = ((await imap.search({ seen: false }, { uid: true })) || []).slice(0, opts.maxMessages ?? 50)
        for (const uid of uids) {
          const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true })
          if (msg && msg.source) {
            const r = await processRawMessage(companyId, msg.source)
            created += r.results.filter((x) => x.status === 'CRIADO').length
            duplicates += r.results.filter((x) => x.status === 'JA_IMPORTADO').length
            errors += r.results.filter((x) => x.status === 'ERRO').length
          }
          // marca como lida mesmo sem XML: a caixa é dedicada a notas e não deve reprocessar
          await imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
          messages++
        }
      } finally {
        lock.release()
      }
    } finally {
      await imap.logout().catch(() => imap.close())
    }
    await db
      .update(mailInboxes)
      .set({
        lastCheckAt: startedAt,
        lastSuccessAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        messagesProcessed: inbox.messagesProcessed + messages,
        documentsReceived: inbox.documentsReceived + created,
      })
      .where(eq(mailInboxes.id, inbox.id))
    return { skipped: false as const, ok: true as const, messages, created, duplicates, errors }
  } catch (e) {
    const message = friendlyMailError(e)
    await db.update(mailInboxes).set({ lastCheckAt: startedAt, lastError: message, lastErrorAt: new Date() }).where(eq(mailInboxes.id, inbox.id))
    return { skipped: false as const, ok: false as const, error: message, messages, created, duplicates, errors }
  } finally {
    running.delete(companyId)
  }
}

// ------------------------------------------------------------------ configuração
export function publicInbox(i: typeof mailInboxes.$inferSelect | undefined | null) {
  if (!i) return null
  const { passwordEnc, ...rest } = i
  return { ...rest, hasPassword: !!passwordEnc }
}

export async function getInbox(companyId: string) {
  return publicInbox(await db.query.mailInboxes.findFirst({ where: eq(mailInboxes.companyId, companyId) }))
}

export async function saveInbox(
  companyId: string,
  userId: string | null,
  input: { host: string; port: number; secure: boolean; username: string; password?: string; mailbox?: string; enabled?: boolean },
) {
  const current = await db.query.mailInboxes.findFirst({ where: eq(mailInboxes.companyId, companyId) })
  let password = input.password
  if (!password) {
    if (!current) throw badRequest('SEM_SENHA', 'Informe a senha da caixa de e-mail.')
    try {
      password = decrypt(current.passwordEnc)
    } catch {
      throw badRequest('SEM_SENHA', 'Informe a senha da caixa de e-mail de novo.')
    }
  }
  const conn = { host: input.host.trim(), port: input.port, secure: input.secure, username: input.username.trim(), password, mailbox: input.mailbox?.trim() || 'INBOX' }
  let test
  try {
    test = await testConnection(conn)
  } catch (e) {
    throw badRequest('EMAIL_FALHOU', friendlyMailError(e))
  }
  const values = {
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    username: conn.username,
    passwordEnc: encrypt(password),
    mailbox: conn.mailbox,
    enabled: input.enabled ?? true,
    lastError: null,
    lastErrorAt: null,
    updatedAt: new Date(),
  }
  if (current) await db.update(mailInboxes).set(values).where(eq(mailInboxes.id, current.id))
  else await db.insert(mailInboxes).values({ companyId, ...values })
  await audit(db, { companyId, userId, entity: 'company', entityId: companyId, action: current ? 'mail_inbox_updated' : 'mail_inbox_connected', data: { host: conn.host, username: conn.username } })
  return { inbox: await getInbox(companyId), test }
}

export async function setInboxEnabled(companyId: string, userId: string | null, enabled: boolean) {
  const [row] = await db.update(mailInboxes).set({ enabled, updatedAt: new Date() }).where(eq(mailInboxes.companyId, companyId)).returning({ id: mailInboxes.id })
  if (!row) throw notFound('Caixa de e-mail')
  await audit(db, { companyId, userId, entity: 'company', entityId: companyId, action: enabled ? 'mail_inbox_enabled' : 'mail_inbox_paused' })
  return getInbox(companyId)
}

export async function removeInbox(companyId: string, userId: string | null) {
  await db.delete(mailInboxes).where(eq(mailInboxes.companyId, companyId))
  await audit(db, { companyId, userId, entity: 'company', entityId: companyId, action: 'mail_inbox_removed' })
}

// ------------------------------------------------------------------ leitura periódica
let timer: NodeJS.Timeout | null = null

export function startMailPoller(log: (msg: string) => void = console.log) {
  const seconds = Number(process.env.MAIL_POLL_SECONDS ?? 120)
  if (seconds <= 0 || timer) return
  const tick = async () => {
    try {
      const active = await db
        .select({ companyId: mailInboxes.companyId })
        .from(mailInboxes)
        .innerJoin(companies, eq(companies.id, mailInboxes.companyId))
        .where(and(eq(mailInboxes.enabled, true), eq(companies.status, 'ATIVA')))
      for (const { companyId } of active) {
        const r = await checkInbox(companyId)
        if (!r.skipped && (r.messages || !r.ok)) {
          log(`[e-mail de notas] ${companyId}: ${r.ok ? `${r.messages} e-mail(s), ${r.created} nota(s) nova(s)` : r.error}`)
        }
      }
    } catch (e) {
      log(`[e-mail de notas] falha geral: ${(e as Error).message}`)
    }
  }
  timer = setInterval(tick, seconds * 1000)
  setTimeout(tick, 5000)
  log(`[e-mail de notas] leitura automática a cada ${seconds}s`)
}
