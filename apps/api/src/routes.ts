import { createReadStream } from 'node:fs'
import bcrypt from 'bcryptjs'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AuthUser } from './app.js'
import { db } from './db/client.js'
import {
  COST_CATEGORIES,
  alerts,
  auditLogs,
  companies,
  documents,
  projectBudgets,
  projects,
  suppliers,
  users,
} from './db/schema.js'
import { isValidCnpj, onlyDigits } from './domain/cnpj.js'
import { changePassword, createUser } from './services/accounts.js'
import { audit } from './services/audit.js'
import { exportAllocations, exportPayables } from './services/exports.js'
import { getDashboard } from './services/dashboard.js'
import {
  approveDocument,
  cancelDocument,
  getDocument,
  ingestManualFile,
  ingestNfeXml,
  listDocuments,
  listPayables,
  registerPayment,
  rejectDocument,
  updateDocumentDraft,
} from './services/documents.js'
import { AppError, badRequest, notFound } from './services/errors.js'
import { computeProjectFinancials } from './services/financials.js'

const category = z.enum(COST_CATEGORIES as unknown as [string, ...string[]]) as z.ZodType<(typeof COST_CATEGORIES)[number]>
const cents = z.number().int()
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const me = (req: FastifyRequest) => req.user as AuthUser

function requireRole(req: FastifyRequest, ...roles: AuthUser['role'][]) {
  if (!roles.includes(me(req).role)) throw new AppError(403, 'SEM_PERMISSAO', 'Seu perfil não tem permissão para esta ação.')
}

async function readUpload(req: FastifyRequest) {
  const files: Array<{ fileName: string; content: Buffer }> = []
  for await (const part of req.files()) {
    files.push({ fileName: part.filename, content: await part.toBuffer() })
  }
  return files
}

function looksLikeXml(name: string, content: Buffer) {
  return name.toLowerCase().endsWith('.xml') || content.subarray(0, 200).toString('utf8').trimStart().startsWith('<')
}

export async function registerRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ auth
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body)
    const user = await db.query.users.findFirst({ where: eq(users.email, body.email.toLowerCase()) })
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ code: 'LOGIN_INVALIDO', message: 'E-mail ou senha incorretos.' })
    }
    const company = await db.query.companies.findFirst({ where: eq(companies.id, user.companyId) })
    const token = app.jwt.sign({ sub: user.id, companyId: user.companyId, role: user.role, name: user.name })
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, company: { id: company!.id, name: company!.name, cnpj: company!.cnpj } }
  })

  // ------------------------------------------------- integrações (sem login)
  /**
   * Entrada para n8n / caixa de e-mail: POST com header x-api-key e o XML no corpo
   * (Content-Type: application/xml) ou em multipart.
   */
  app.post('/api/integrations/nfe', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const key = req.headers['x-api-key']
    if (typeof key !== 'string') return reply.code(401).send({ code: 'SEM_CHAVE', message: 'Informe o header x-api-key.' })
    const company = await db.query.companies.findFirst({ where: eq(companies.apiKey, key) })
    if (!company) return reply.code(401).send({ code: 'CHAVE_INVALIDA', message: 'Chave de integração inválida.' })
    const source = req.headers['x-source'] === 'email' ? 'EMAIL' : 'API'
    const files = req.isMultipart() ? await readUpload(req) : Buffer.isBuffer(req.body) ? [{ fileName: String(req.headers['x-filename'] ?? 'nfe.xml'), content: req.body }] : []
    if (!files.length) throw badRequest('SEM_ARQUIVO', 'Envie o XML no corpo (application/xml) ou em multipart.')
    const results = []
    for (const f of files) {
      try {
        const r = await ingestNfeXml({ companyId: company.id, fileName: f.fileName, content: f.content, source })
        results.push({ fileName: f.fileName, status: r.status, documentId: r.documentId, documentStatus: r.document.status })
      } catch (e) {
        results.push({ fileName: f.fileName, status: 'ERRO', message: (e as Error).message })
      }
    }
    return { results }
  })

  // ---------------------------------------------------------- protegido
  await app.register(async (r) => {
    r.addHook('onRequest', app.authenticate)

    r.get('/api/auth/me', async (req) => {
      const u = me(req)
      const user = await db.query.users.findFirst({ where: eq(users.id, u.sub) })
      const company = await db.query.companies.findFirst({ where: eq(companies.id, u.companyId) })
      if (!user || !company) throw notFound('Usuário')
      return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, company: { id: company.id, name: company.name, cnpj: company.cnpj } }
    })

    // ---------------------------------------------------------- dashboard
    r.get('/api/dashboard', async (req) => {
      const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)
      return getDashboard(me(req).companyId, q.from, q.to)
    })

    // -------------------------------------------------------------- obras
    r.get('/api/projects', async (req) => {
      const { companyId } = me(req)
      const rows = await db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(projects.code)
      const fin = await computeProjectFinancials(db, companyId)
      return rows.map((p) => ({ ...p, financials: fin.get(p.id) }))
    })

    r.get('/api/projects/:id', async (req) => {
      const { companyId } = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const project = await db.query.projects.findFirst({ where: and(eq(projects.companyId, companyId), eq(projects.id, id)) })
      if (!project) throw notFound('Obra')
      const fin = (await computeProjectFinancials(db, companyId, [id])).get(id)
      const [docs, pays, projAlerts] = await Promise.all([
        listDocuments(companyId, { projectId: id }),
        listPayables(companyId, { projectId: id, status: 'ABERTO,PARCIAL,PAGO' }),
        db.select().from(alerts).where(and(eq(alerts.projectId, id), eq(alerts.status, 'ABERTO'))).orderBy(desc(alerts.createdAt)),
      ])
      return { ...project, financials: fin, documents: docs, payables: pays, alerts: projAlerts }
    })

    const projectBody = z.object({
      code: z.string().min(1).max(30),
      name: z.string().min(2),
      address: z.string().optional().nullable(),
      status: z.enum(['ATIVA', 'PAUSADA', 'CONCLUIDA']).optional(),
      startDate: ymd.optional().nullable(),
      endDate: ymd.optional().nullable(),
      budgetTotal: cents.nonnegative(),
      imageUrl: z.string().url().optional().nullable(),
      budgets: z.array(z.object({ category, amount: cents.nonnegative() })).optional(),
    })

    r.post('/api/projects', async (req, reply) => {
      const u = me(req)
      requireRole(req, 'ADMIN', 'GESTOR_OBRA')
      const body = projectBody.parse(req.body)
      const project = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(projects)
          .values({
            companyId: u.companyId,
            code: body.code,
            name: body.name,
            address: body.address,
            status: body.status,
            startDate: body.startDate ? new Date(body.startDate) : null,
            endDate: body.endDate ? new Date(body.endDate) : null,
            budgetTotal: body.budgetTotal,
            imageUrl: body.imageUrl,
          })
          .returning()
        if (body.budgets?.length) await tx.insert(projectBudgets).values(body.budgets.map((b) => ({ projectId: p.id, ...b })))
        await audit(tx, { companyId: u.companyId, userId: u.sub, entity: 'project', entityId: p.id, action: 'created', data: body })
        return p
      })
      return reply.code(201).send(project)
    })

    r.patch('/api/projects/:id', async (req) => {
      const u = me(req)
      requireRole(req, 'ADMIN', 'GESTOR_OBRA')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = projectBody.partial().parse(req.body)
      return db.transaction(async (tx) => {
        const [p] = await tx
          .update(projects)
          .set({
            ...(body.code && { code: body.code }),
            ...(body.name && { name: body.name }),
            ...(body.address !== undefined && { address: body.address }),
            ...(body.status && { status: body.status }),
            ...(body.budgetTotal !== undefined && { budgetTotal: body.budgetTotal }),
            ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
            ...(body.startDate !== undefined && { startDate: body.startDate ? new Date(body.startDate) : null }),
            ...(body.endDate !== undefined && { endDate: body.endDate ? new Date(body.endDate) : null }),
          })
          .where(and(eq(projects.companyId, u.companyId), eq(projects.id, id)))
          .returning()
        if (!p) throw notFound('Obra')
        if (body.budgets) {
          await tx.delete(projectBudgets).where(eq(projectBudgets.projectId, id))
          if (body.budgets.length) await tx.insert(projectBudgets).values(body.budgets.map((b) => ({ projectId: id, ...b })))
        }
        await audit(tx, { companyId: u.companyId, userId: u.sub, entity: 'project', entityId: id, action: 'updated', data: body })
        return p
      })
    })

    // -------------------------------------------------------- fornecedores
    r.get('/api/suppliers', async (req) => {
      const { companyId } = me(req)
      const q = z.object({ q: z.string().optional(), category: category.optional() }).parse(req.query)
      return db
        .select({
          id: suppliers.id,
          cnpj: suppliers.cnpj,
          name: suppliers.name,
          tradeName: suppliers.tradeName,
          defaultCategory: suppliers.defaultCategory,
          status: suppliers.status,
          email: suppliers.email,
          phone: suppliers.phone,
          documentsCount: sql<number>`(SELECT count(*)::int FROM fiscal_documents d WHERE d.supplier_id = "suppliers"."id" AND d.status = 'APROVADO')`,
          purchasedTotal: sql<number>`(SELECT coalesce(sum(d.total_amount),0)::bigint FROM fiscal_documents d WHERE d.supplier_id = "suppliers"."id" AND d.status = 'APROVADO')`,
          lastPurchase: sql<string | null>`(SELECT max(d.issue_date) FROM fiscal_documents d WHERE d.supplier_id = "suppliers"."id" AND d.status = 'APROVADO')`,
        })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.companyId, companyId),
            q.category ? eq(suppliers.defaultCategory, q.category) : undefined,
            q.q ? sql`(${suppliers.name} ILIKE ${'%' + q.q + '%'} OR ${suppliers.cnpj} LIKE ${'%' + onlyDigits(q.q) + '%'})` : undefined,
          ),
        )
        .orderBy(suppliers.name)
    })

    const supplierBody = z.object({
      cnpj: z.string(),
      name: z.string().min(2),
      tradeName: z.string().optional().nullable(),
      defaultCategory: category.optional().nullable(),
      status: z.enum(['HOMOLOGADO', 'PENDENTE', 'BLOQUEADO']).optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
    })

    r.post('/api/suppliers', async (req, reply) => {
      const u = me(req)
      const body = supplierBody.parse(req.body)
      const cnpj = onlyDigits(body.cnpj)
      if (!isValidCnpj(cnpj)) throw badRequest('CNPJ_INVALIDO', 'CNPJ inválido.')
      const [s] = await db.insert(suppliers).values({ ...body, cnpj, companyId: u.companyId }).returning()
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'supplier', entityId: s.id, action: 'created', data: body })
      return reply.code(201).send(s)
    })

    r.patch('/api/suppliers/:id', async (req) => {
      const u = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = supplierBody.omit({ cnpj: true }).partial().parse(req.body)
      if (body.status) requireRole(req, 'ADMIN', 'FINANCEIRO')
      const [s] = await db.update(suppliers).set(body).where(and(eq(suppliers.companyId, u.companyId), eq(suppliers.id, id))).returning()
      if (!s) throw notFound('Fornecedor')
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'supplier', entityId: id, action: 'updated', data: body })
      return s
    })

    // --------------------------------------------------------- documentos
    r.get('/api/documents', async (req) => {
      const q = z.object({ status: z.string().optional(), projectId: z.string().uuid().optional(), q: z.string().optional() }).parse(req.query)
      return listDocuments(me(req).companyId, q)
    })

    r.get('/api/documents/:id', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      return getDocument(me(req).companyId, id)
    })

    r.get('/api/documents/:id/file', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const doc = await db.query.documents.findFirst({ where: and(eq(documents.companyId, me(req).companyId), eq(documents.id, id)) })
      if (!doc?.filePath) throw notFound('Arquivo')
      const isXml = doc.fileName?.toLowerCase().endsWith('.xml')
      const isPdf = doc.fileName?.toLowerCase().endsWith('.pdf')
      reply.header('Content-Type', isXml ? 'application/xml' : isPdf ? 'application/pdf' : 'application/octet-stream')
      reply.header('Content-Disposition', `inline; filename="${(doc.fileName ?? 'documento').replace(/"/g, '')}"`)
      return reply.send(createReadStream(doc.filePath))
    })

    /** Upload de um ou vários arquivos: XML de NF-e é lido; PDF/imagem abre documento para digitação. */
    r.post('/api/documents/upload', async (req) => {
      const u = me(req)
      const files = await readUpload(req)
      if (!files.length) throw badRequest('SEM_ARQUIVO', 'Selecione ao menos um arquivo.')
      const results = []
      for (const f of files) {
        try {
          const res = looksLikeXml(f.fileName, f.content)
            ? await ingestNfeXml({ companyId: u.companyId, userId: u.sub, fileName: f.fileName, content: f.content, source: 'UPLOAD' })
            : await ingestManualFile({ companyId: u.companyId, userId: u.sub, fileName: f.fileName, content: f.content, source: 'UPLOAD' })
          results.push({ fileName: f.fileName, status: res.status, documentId: res.documentId, document: res.document })
        } catch (e) {
          results.push({ fileName: f.fileName, status: 'ERRO', message: e instanceof AppError ? e.message : 'Falha ao processar arquivo.' })
        }
      }
      return { results }
    })

    r.patch('/api/documents/:id', async (req) => {
      const u = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = z
        .object({
          supplierCnpj: z.string().optional(),
          supplierName: z.string().optional(),
          number: z.string().optional(),
          issueDate: ymd.optional(),
          totalAmount: cents.positive().optional(),
          description: z.string().optional(),
          category: category.optional(),
          suggestedProjectId: z.string().uuid().nullable().optional(),
        })
        .parse(req.body)
      return updateDocumentDraft(u.companyId, u.sub, id, body)
    })

    r.post('/api/documents/:id/approve', async (req) => {
      const u = me(req)
      requireRole(req, 'ADMIN', 'FINANCEIRO')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = z
        .object({
          allocations: z.array(z.object({ projectId: z.string().uuid(), category, amount: cents.positive() })).min(1),
          installments: z.array(z.object({ dueDate: ymd, amount: cents.positive() })).optional(),
          notes: z.string().optional(),
          acknowledgeCritical: z.boolean().optional(),
        })
        .parse(req.body)
      return approveDocument(u.companyId, u.sub, id, body)
    })

    r.post('/api/documents/:id/reject', async (req) => {
      const u = me(req)
      requireRole(req, 'ADMIN', 'FINANCEIRO')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body)
      return rejectDocument(u.companyId, u.sub, id, reason)
    })

    r.post('/api/documents/:id/cancel', async (req) => {
      const u = me(req)
      requireRole(req, 'ADMIN', 'FINANCEIRO')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body)
      return cancelDocument(u.companyId, u.sub, id, reason)
    })

    // ------------------------------------------------------ contas a pagar
    r.get('/api/payables', async (req) => {
      const q = z.object({ status: z.string().optional(), from: ymd.optional(), to: ymd.optional(), projectId: z.string().uuid().optional() }).parse(req.query)
      return listPayables(me(req).companyId, q)
    })

    r.post('/api/payables/:id/payments', async (req) => {
      const u = me(req)
      requireRole(req, 'ADMIN', 'FINANCEIRO')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = z.object({ amount: cents.positive(), paidAt: ymd, method: z.string().optional() }).parse(req.body)
      return registerPayment(u.companyId, u.sub, id, body)
    })

    // ------------------------------------------------------------- alertas
    r.get('/api/alerts', async (req) => {
      const q = z.object({ status: z.string().optional() }).parse(req.query)
      return db
        .select({
          id: alerts.id,
          type: alerts.type,
          severity: alerts.severity,
          status: alerts.status,
          title: alerts.title,
          message: alerts.message,
          projectId: alerts.projectId,
          documentId: alerts.documentId,
          supplierId: alerts.supplierId,
          createdAt: alerts.createdAt,
          resolvedAt: alerts.resolvedAt,
          projectName: projects.name,
          supplierName: suppliers.name,
        })
        .from(alerts)
        .leftJoin(projects, eq(projects.id, alerts.projectId))
        .leftJoin(suppliers, eq(suppliers.id, alerts.supplierId))
        .where(and(eq(alerts.companyId, me(req).companyId), inArray(alerts.status, (q.status ?? 'ABERTO').split(',') as any)))
        .orderBy(sql`case ${alerts.severity} when 'CRITICO' then 0 when 'ATENCAO' then 1 when 'OPORTUNIDADE' then 2 else 3 end`, desc(alerts.createdAt))
        .limit(200)
    })

    r.post('/api/alerts/:id/:action', async (req) => {
      const u = me(req)
      const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(['resolve', 'ignore', 'reopen']) }).parse(req.params)
      const status = action === 'resolve' ? 'RESOLVIDO' : action === 'ignore' ? 'IGNORADO' : 'ABERTO'
      const [a] = await db
        .update(alerts)
        .set({ status, resolvedAt: status === 'ABERTO' ? null : new Date() })
        .where(and(eq(alerts.companyId, u.companyId), eq(alerts.id, id)))
        .returning()
      if (!a) throw notFound('Alerta')
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'alert', entityId: id, action })
      return a
    })

    // ------------------------------------------------------ auditoria/config
    r.get('/api/audit', async (req) => {
      const q = z.object({ entity: z.string(), entityId: z.string() }).parse(req.query)
      return db
        .select({ id: auditLogs.id, action: auditLogs.action, data: auditLogs.data, createdAt: auditLogs.createdAt, userName: users.name })
        .from(auditLogs)
        .leftJoin(users, sql`${users.id} = ${auditLogs.userId}`)
        .where(and(eq(auditLogs.companyId, me(req).companyId), eq(auditLogs.entity, q.entity), eq(auditLogs.entityId, q.entityId)))
        .orderBy(desc(auditLogs.createdAt))
    })

    // ------------------------------------------------------------- conta
    r.post('/api/auth/password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
      const body = z.object({ current: z.string().min(1), next: z.string().min(10) }).parse(req.body)
      await changePassword(me(req).sub, body.current, body.next)
      return { ok: true }
    })

    r.get('/api/users', async (req) => {
      requireRole(req, 'ADMIN')
      return db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.companyId, me(req).companyId))
        .orderBy(users.name)
    })

    r.post('/api/users', async (req, reply) => {
      requireRole(req, 'ADMIN')
      const body = z
        .object({ name: z.string().min(2), email: z.string().email(), role: z.enum(['ADMIN', 'FINANCEIRO', 'GESTOR_OBRA']) })
        .parse(req.body)
      const res = await createUser({ ...body, companyId: me(req).companyId, createdBy: me(req).sub })
      // a senha provisória só é mostrada uma vez
      return reply.code(201).send(res)
    })

    // ---------------------------------------------------------- exportações
    r.get('/api/exports/payables.csv', async (req, reply) => {
      const q = z.object({ status: z.string().optional(), from: ymd.optional(), to: ymd.optional(), projectId: z.string().uuid().optional() }).parse(req.query)
      const csv = await exportPayables(me(req).companyId, q)
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="contas-a-pagar-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv)
    })

    r.get('/api/exports/lancamentos.csv', async (req, reply) => {
      const q = z.object({ from: ymd.optional(), to: ymd.optional(), projectId: z.string().uuid().optional() }).parse(req.query)
      const csv = await exportAllocations(me(req).companyId, q)
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="lancamentos-por-obra-${q.from ?? 'inicio'}-a-${q.to ?? 'hoje'}.csv"`)
        .send(csv)
    })

    r.get('/api/integrations', async (req) => {
      requireRole(req, 'ADMIN')
      const company = await db.query.companies.findFirst({ where: eq(companies.id, me(req).companyId) })
      return { apiKey: company!.apiKey, nfeEndpoint: '/api/integrations/nfe' }
    })
  })
}
