/**
 * Painel da Plataforma — rotas exclusivas da dona da OperaIA.
 * Toda ação fica registrada na auditoria da construtora afetada.
 */
import { randomBytes } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AuthUser } from './app.js'
import { db } from './db/client.js'
import { auditLogs, companies, users } from './db/schema.js'
import { createCompany, createUser, temporaryPassword } from './services/accounts.js'
import { PROVIDERS, checkInbox, getInbox, removeInbox, saveInbox, setInboxEnabled } from './services/mailbox.js'
import { audit } from './services/audit.js'
import { AppError, badRequest, notFound } from './services/errors.js'
import bcrypt from 'bcryptjs'

const roleEnum = z.enum(['ADMIN', 'FINANCEIRO', 'GESTOR_OBRA'])
const me = (req: FastifyRequest) => req.user as AuthUser

async function requireOwner(req: FastifyRequest) {
  const u = me(req)
  if (!u.platform) throw new AppError(403, 'SEM_PERMISSAO', 'Área exclusiva da dona da plataforma.')
  const owner = await db.query.users.findFirst({ where: eq(users.id, u.sub) })
  if (!owner?.isPlatformOwner) throw new AppError(403, 'SEM_PERMISSAO', 'Área exclusiva da dona da plataforma.')
  return owner
}

/** Uso de cada construtora em uma consulta só */
async function companiesWithUsage(id?: string) {
  const { rows } = await db.execute(sql`
    SELECT c.id, c.name, c.cnpj, c.status, c.notes, c.created_at, c.suspended_at,
      (SELECT count(*)::int FROM users u WHERE u.company_id = c.id AND u.active) AS users_active,
      (SELECT count(*)::int FROM projects p WHERE p.company_id = c.id AND p.status = 'ATIVA') AS projects_active,
      (SELECT count(*)::int FROM fiscal_documents d WHERE d.company_id = c.id) AS documents_total,
      (SELECT count(*)::int FROM fiscal_documents d WHERE d.company_id = c.id AND d.created_at > now() - interval '30 days') AS documents_30d,
      (SELECT count(*)::int FROM fiscal_documents d WHERE d.company_id = c.id AND d.status IN ('RECEBIDO','EM_REVISAO')) AS documents_pending,
      (SELECT coalesce(sum(d.total_amount),0)::bigint FROM fiscal_documents d WHERE d.company_id = c.id AND d.status = 'APROVADO' AND d.created_at > now() - interval '30 days') AS approved_30d,
      (SELECT max(d.created_at) FROM fiscal_documents d WHERE d.company_id = c.id) AS last_document_at,
      (SELECT max(u.last_login_at) FROM users u WHERE u.company_id = c.id) AS last_login_at,
      m.enabled AS mail_enabled, m.last_success_at AS mail_last_success_at, m.last_error AS mail_last_error, m.documents_received AS mail_documents
    FROM companies c
    LEFT JOIN mail_inboxes m ON m.company_id = c.id
    ${id ? sql`WHERE c.id = ${id}` : sql``}
    ORDER BY c.created_at DESC`)
  return rows.map((r: any) => ({
    id: r.id as string,
    name: r.name as string,
    cnpj: r.cnpj as string,
    status: r.status as 'ATIVA' | 'SUSPENSA',
    notes: r.notes as string | null,
    createdAt: r.created_at,
    suspendedAt: r.suspended_at,
    usersActive: r.users_active as number,
    projectsActive: r.projects_active as number,
    documentsTotal: r.documents_total as number,
    documents30d: r.documents_30d as number,
    documentsPending: r.documents_pending as number,
    approved30d: Number(r.approved_30d),
    lastDocumentAt: r.last_document_at,
    lastLoginAt: r.last_login_at,
    mail:
      r.mail_enabled === null || r.mail_enabled === undefined
        ? null
        : { enabled: r.mail_enabled as boolean, lastSuccessAt: r.mail_last_success_at, lastError: r.mail_last_error as string | null, documents: Number(r.mail_documents) },
  }))
}

export async function registerPlatformRoutes(r: FastifyInstance) {
  r.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/platform/') && !req.url.startsWith('/api/platform/return')) await requireOwner(req)
  })

  r.get('/api/platform/overview', async () => {
    const list = await companiesWithUsage()
    return {
      companiesActive: list.filter((c) => c.status === 'ATIVA').length,
      companiesSuspended: list.filter((c) => c.status === 'SUSPENSA').length,
      usersActive: list.reduce((a, c) => a + c.usersActive, 0),
      documents30d: list.reduce((a, c) => a + c.documents30d, 0),
      approved30d: list.reduce((a, c) => a + c.approved30d, 0),
      companies: list,
    }
  })

  r.post('/api/platform/companies', async (req, reply) => {
    const owner = await requireOwner(req)
    const body = z
      .object({ name: z.string().min(2), cnpj: z.string(), adminName: z.string().min(2), adminEmail: z.string().email(), notes: z.string().optional() })
      .parse(req.body)
    const c = await createCompany({ name: body.name, cnpj: body.cnpj })
    if (body.notes) await db.update(companies).set({ notes: body.notes }).where(eq(companies.id, c.id))
    let created
    try {
      created = await createUser({ companyId: c.id, name: body.adminName, email: body.adminEmail, role: 'ADMIN', createdBy: owner.id })
    } catch (e) {
      // não deixa construtora órfã se o e-mail do admin já existir
      await db.delete(companies).where(eq(companies.id, c.id))
      throw e
    }
    await audit(db, { companyId: c.id, userId: owner.id, entity: 'company', entityId: c.id, action: 'created_by_platform' })
    return reply.code(201).send({ company: { id: c.id, name: c.name, cnpj: c.cnpj, apiKey: c.apiKey }, admin: created.user, password: created.password })
  })

  r.get('/api/platform/companies/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const [company] = await companiesWithUsage(id)
    if (!company) throw notFound('Construtora')
    const [full, team, history] = await Promise.all([
      db.query.companies.findFirst({ where: eq(companies.id, id) }),
      db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, isPlatformOwner: users.isPlatformOwner, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.companyId, id))
        .orderBy(users.name),
      db
        .select({ id: auditLogs.id, entity: auditLogs.entity, action: auditLogs.action, createdAt: auditLogs.createdAt, userName: users.name })
        .from(auditLogs)
        .leftJoin(users, sql`${users.id} = ${auditLogs.userId}`)
        .where(and(eq(auditLogs.companyId, id), sql`${auditLogs.entity} IN ('company','user')`))
        .orderBy(desc(auditLogs.createdAt))
        .limit(30),
    ])
    return { ...company, apiKey: full!.apiKey, users: team, history }
  })

  r.patch('/api/platform/companies/:id', async (req) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const body = z.object({ name: z.string().min(2).optional(), status: z.enum(['ATIVA', 'SUSPENSA']).optional(), notes: z.string().nullable().optional() }).parse(req.body)
    const current = await db.query.companies.findFirst({ where: eq(companies.id, id) })
    if (!current) throw notFound('Construtora')
    if (body.status === 'SUSPENSA' && current.id === owner.companyId) {
      throw badRequest('PROPRIA', 'Você não pode suspender a construtora do seu próprio login.')
    }
    const [c] = await db
      .update(companies)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.status && { status: body.status, suspendedAt: body.status === 'SUSPENSA' ? new Date() : null }),
      })
      .where(eq(companies.id, id))
      .returning()
    const action = body.status && body.status !== current.status ? (body.status === 'SUSPENSA' ? 'suspended' : 'reactivated') : 'updated'
    await audit(db, { companyId: id, userId: owner.id, entity: 'company', entityId: id, action, data: body })
    return { id: c.id, name: c.name, status: c.status, notes: c.notes }
  })

  r.post('/api/platform/companies/:id/rotate-key', async (req) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const apiKey = `oo_${randomBytes(24).toString('hex')}`
    const [c] = await db.update(companies).set({ apiKey }).where(eq(companies.id, id)).returning({ id: companies.id })
    if (!c) throw notFound('Construtora')
    await audit(db, { companyId: id, userId: owner.id, entity: 'company', entityId: id, action: 'api_key_rotated' })
    return { apiKey }
  })

  r.post('/api/platform/companies/:id/users', async (req, reply) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const body = z.object({ name: z.string().min(2), email: z.string().email(), role: roleEnum }).parse(req.body)
    if (!(await db.query.companies.findFirst({ where: eq(companies.id, id) }))) throw notFound('Construtora')
    const res = await createUser({ ...body, companyId: id, createdBy: owner.id })
    return reply.code(201).send(res)
  })

  r.patch('/api/platform/users/:id', async (req) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const body = z.object({ role: roleEnum.optional(), active: z.boolean().optional() }).parse(req.body)
    if (id === owner.id && (body.active === false || (body.role && body.role !== 'ADMIN'))) {
      throw badRequest('PROPRIO', 'Você não pode desativar nem rebaixar o seu próprio acesso.')
    }
    const [u] = await db.update(users).set(body).where(eq(users.id, id)).returning({ id: users.id, companyId: users.companyId, role: users.role, active: users.active })
    if (!u) throw notFound('Usuário')
    await audit(db, { companyId: u.companyId, userId: owner.id, entity: 'user', entityId: id, action: 'updated_by_platform', data: body })
    return u
  })

  r.post('/api/platform/users/:id/reset-password', async (req) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const password = temporaryPassword()
    const [u] = await db.update(users).set({ passwordHash: await bcrypt.hash(password, 10) }).where(eq(users.id, id)).returning({ email: users.email, companyId: users.companyId })
    if (!u) throw notFound('Usuário')
    await audit(db, { companyId: u.companyId, userId: owner.id, entity: 'user', entityId: id, action: 'password_reset_by_platform' })
    return { email: u.email, password }
  })

  // ------------------------------------------------ e-mail de notas de qualquer construtora
  const inboxBody = z.object({
    host: z.string().min(3),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().min(3),
    password: z.string().optional(),
    mailbox: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  r.get('/api/platform/companies/:id/mail-inbox', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    return { inbox: await getInbox(id), providers: PROVIDERS }
  })
  r.put('/api/platform/companies/:id/mail-inbox', async (req) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    return saveInbox(id, owner.id, inboxBody.parse(req.body))
  })
  r.post('/api/platform/companies/:id/mail-inbox/check', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    return { result: await checkInbox(id), inbox: await getInbox(id) }
  })
  r.post('/api/platform/companies/:id/mail-inbox/:action', async (req) => {
    const owner = await requireOwner(req)
    const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['pause', 'resume']) }).parse(req.params)
    return { inbox: await setInboxEnabled(id, owner.id, action === 'resume') }
  })
  r.delete('/api/platform/companies/:id/mail-inbox', async (req) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    await removeInbox(id, owner.id)
    return { inbox: null }
  })

  /** Suporte: entra na construtora como administradora. Fica registrado na auditoria dela. */
  r.post('/api/platform/companies/:id/impersonate', async (req) => {
    const owner = await requireOwner(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const company = await db.query.companies.findFirst({ where: eq(companies.id, id) })
    if (!company) throw notFound('Construtora')
    await audit(db, { companyId: id, userId: owner.id, entity: 'company', entityId: id, action: 'support_session_started' })
    const token = r.jwt.sign(
      { sub: owner.id, companyId: id, role: 'ADMIN', name: owner.name, platform: true, impersonating: true },
      { expiresIn: '2h' },
    )
    return { token }
  })

  /** Volta para a própria construtora (encerra a sessão de suporte) */
  r.post('/api/platform/return', async (req) => {
    const u = me(req)
    const owner = await db.query.users.findFirst({ where: eq(users.id, u.sub) })
    if (!owner) throw notFound('Usuário')
    const token = r.jwt.sign({ sub: owner.id, companyId: owner.companyId, role: owner.role, name: owner.name, platform: owner.isPlatformOwner || undefined })
    return { token }
  })
}
