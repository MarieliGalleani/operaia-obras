import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AuthUser } from './app.js'
import { db } from './db/client.js'
import {
  COST_CATEGORIES,
  alerts,
  idempotencyKeys,
  auditLogs,
  companies,
  documents,
  projectBudgets,
  projects,
  suppliers,
  users,
} from './db/schema.js'
import { isValidCnpj, normalizeCnpj } from './domain/cnpj.js'
import { changePassword, createUser } from './services/accounts.js'
import { registerOwnerRoutes } from './owner.js'
import { registerPlatformRoutes } from './platform.js'
import { audit } from './services/audit.js'
import { exportAccountantZip, exportAllocations, exportPayables } from './services/exports.js'
import { exportReport, getReports } from './services/reports.js'
import { getSupplierPriceSummaries, getSupplierPrices } from './services/prices.js'
import { PROVIDERS, checkInbox, getInbox, removeInbox, saveInbox, setInboxEnabled } from './services/mailbox.js'
import { getDashboard } from './services/dashboard.js'
import { confirmImport, importTemplate, previewImport } from './services/imports.js'
import {
  DEFAULT_STAGES,
  addSitePhoto,
  createMaterialRequest,
  createOccurrence,
  declineMaterialRequest,
  fieldProject,
  fieldProjects,
  listMaterialRequests,
  receiveDelivery,
  resolveOccurrence,
  setStages,
  updateStageProgress,
} from './services/field.js'
import { approveOrder, cancelOrder, createOrder, getDeliveryStats, getOrder, linkDocumentToOrder, listOrders, updateOrder } from './services/purchases.js'
import {
  approveDocument,
  cancelDocument,
  getDocument,
  ingestManualFile,
  ingestNfeXml,
  listDocuments,
  listPayables,
  listPayments,
  registerPayment,
  reversePayment,
  rejectDocument,
  updateDocumentDraft,
} from './services/documents.js'
import { AppError, badRequest, notFound } from './services/errors.js'
import { ACTIONS, ROLE_DEFAULTS, SCREENS, apiAllowed, canProject, effectivePerms, ownerApiAllowed, type Action } from './services/permissions.js'
import { computeProjectFinancials } from './services/financials.js'
import { contentTypeOf, storage } from './services/storage.js'
import { alertInScope, assertDocument, assertPayable, assertProjectRow } from './services/scope.js'

const category = z.enum(COST_CATEGORIES as unknown as [string, ...string[]]) as z.ZodType<(typeof COST_CATEGORIES)[number]>
const cents = z.number().int()
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const me = (req: FastifyRequest) => req.user as AuthUser

function requireRole(req: FastifyRequest, ...roles: AuthUser['role'][]) {
  if (!roles.includes(me(req).role)) throw new AppError(403, 'SEM_PERMISSAO', 'Seu perfil não tem permissão para esta ação.')
}
const ACTION_LABEL: Record<Action, string> = {
  aprovar_notas: 'aprovar notas',
  pagamentos: 'registrar pagamentos',
  aprovar_pedidos: 'aprovar pedidos de compra',
  editar_obras: 'editar obras e orçamento',
  homologar_fornecedores: 'homologar fornecedores',
}
/** Ação liberada pelo administrador para esta pessoa (perfil + ajustes). */
function requireAction(req: FastifyRequest, action: Action) {
  if (!req.perms.actions.includes(action)) throw new AppError(403, 'SEM_PERMISSAO', `Você não tem liberação para ${ACTION_LABEL[action]}. Fale com o administrador.`)
}
/** Obra liberada para esta pessoa (quando o administrador restringiu as obras). */
function requireProject(req: FastifyRequest, projectId: string) {
  if (!canProject(req.perms, projectId)) throw notFound('Obra')
}

async function readUpload(req: FastifyRequest) {
  const files: Array<{ fileName: string; content: Buffer }> = []
  for await (const part of req.files()) {
    files.push({ fileName: part.filename, content: await part.toBuffer() })
  }
  return files
}

const MEDIA_KEY = (file: string) => `media/obras/${file}`
const MEDIA_PREFIX = '/api/media/obras/'
const MEDIA_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/

/** Tipo da imagem pelo conteúdo (não confia na extensão enviada). */
export function imageKind(b: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}
async function removeOwnMedia(url: string | null | undefined) {
  if (!url?.startsWith(MEDIA_PREFIX)) return
  const file = url.slice(MEDIA_PREFIX.length).split('?')[0]
  if (MEDIA_FILE.test(file)) await storage().delete(MEDIA_KEY(file)).catch(() => {})
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
    if (!user.active) {
      return reply.code(403).send({ code: 'ACESSO_DESATIVADO', message: 'Seu acesso foi desativado. Fale com o administrador da sua construtora.' })
    }
    const company = await db.query.companies.findFirst({ where: eq(companies.id, user.companyId) })
    if (company!.status === 'SUSPENSA' && !user.isPlatformOwner) {
      return reply.code(403).send({ code: 'CONSTRUTORA_SUSPENSA', message: 'O acesso desta construtora está suspenso. Fale com a OperaIA.' })
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))
    const token = app.jwt.sign({ sub: user.id, companyId: user.companyId, role: user.role, name: user.name, platform: user.isPlatformOwner || undefined })
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isPlatformOwner: user.isPlatformOwner },
      company: { id: company!.id, name: company!.name, cnpj: company!.cnpj },
      impersonating: false,
    }
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
    if (company.status === 'SUSPENSA') return reply.code(403).send({ code: 'CONSTRUTORA_SUSPENSA', message: 'Construtora suspensa: notas não estão sendo recebidas.' })
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

  // ------------------------------------------- fotos das obras (sem login)
  // Nome aleatório de 128 bits: só quem recebeu a URL pelo sistema encontra o arquivo.
  app.get('/api/media/obras/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string() }).parse(req.params)
    if (!MEDIA_FILE.test(file)) throw notFound('Imagem')
    const content = await storage().get(MEDIA_KEY(file))
    if (!content) throw notFound('Imagem')
    return reply.type(contentTypeOf(file)).header('cache-control', 'public, max-age=31536000, immutable').send(content)
  })

  // ---------------------------------------------------------- protegido
  await app.register(async (r) => {
    r.addHook('onRequest', app.authenticate)
    // Liberações: "ver como" é só leitura; cada grupo de rotas exige a tela correspondente
    r.addHook('onRequest', async (req, reply) => {
      const u = req.user as AuthUser | undefined
      if (!u || !req.perms) return
      if (u.readOnly && req.method !== 'GET') {
        return reply.code(403).send({ code: 'SO_LEITURA', message: `Você está vendo o sistema como ${u.name}: só leitura. Volte ao seu acesso para alterar.` })
      }
      if (u.role === 'PROPRIETARIO' && !ownerApiAllowed(req.url)) {
        return reply.code(403).send({ code: 'SO_PORTAL', message: 'Seu acesso é o portal do proprietário.' })
      }
      if (u.role !== 'PROPRIETARIO' && req.url.startsWith('/api/owner/')) {
        return reply.code(403).send({ code: 'SO_PROPRIETARIO', message: 'Área do proprietário da obra.' })
      }
      if (apiAllowed(req.url, req.perms) === false) {
        return reply.code(403).send({ code: 'SEM_PERMISSAO', message: 'Esta tela não foi liberada para você. Fale com o administrador.' })
      }
    })
    // App de obra: reenvio com a mesma Idempotency-Key devolve a resposta já gravada
    r.addHook('preHandler', async (req, reply) => {
      const key = req.headers['idempotency-key']
      if (req.method !== 'POST' || !req.url.startsWith('/api/field/') || typeof key !== 'string') return
      if (!/^[\w-]{8,80}$/.test(key)) return reply.code(400).send({ code: 'CHAVE_INVALIDA', message: 'Idempotency-Key inválida.' })
      const [hit] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.companyId, me(req).companyId), eq(idempotencyKeys.key, key)))
      if (hit) return reply.code(hit.statusCode).header('idempotent-replay', 'true').send(hit.response)
    })
    r.addHook('onSend', async (req, reply, payload) => {
      const key = req.headers['idempotency-key']
      if (req.method !== 'POST' || !req.url.startsWith('/api/field/') || typeof key !== 'string' || reply.getHeader('idempotent-replay')) return payload
      if (reply.statusCode >= 300 || typeof payload !== 'string' || !/^[\w-]{8,80}$/.test(key)) return payload
      let response: unknown = null
      try {
        response = JSON.parse(payload)
      } catch {
        return payload
      }
      await db.insert(idempotencyKeys).values({ companyId: me(req).companyId, key, statusCode: reply.statusCode, response }).onConflictDoNothing()
      return payload
    })
    // obras liberadas: nota, título, pedido, solicitação e alerta abertos pelo id
    r.addHook('preHandler', async (req) => {
      const scope = req.perms?.projectIds
      const id = (req.params as { id?: string })?.id
      if (!scope || !id || !/^[0-9a-f-]{36}$/.test(id)) return
      const path = req.url.split('?')[0]
      if (path.startsWith('/api/documents/')) await assertDocument(id, scope)
      else if (path.startsWith('/api/payables/')) await assertPayable(id, scope)
      else if (path.startsWith('/api/purchase-orders/')) await assertProjectRow('purchase_orders', id, scope, 'Pedido')
      else if (path.startsWith('/api/material-requests/')) await assertProjectRow('material_requests', id, scope, 'Solicitação')
      else if (path.startsWith('/api/alerts/')) await assertProjectRow('alerts', id, scope, 'Alerta')
    })
    await r.register(async (p) => registerPlatformRoutes(p))
    await r.register(async (p) => registerOwnerRoutes(p))

    r.get('/api/auth/me', async (req) => {
      const u = me(req)
      const user = await db.query.users.findFirst({ where: eq(users.id, u.sub) })
      const company = await db.query.companies.findFirst({ where: eq(companies.id, u.companyId) })
      if (!user || !company) throw notFound('Usuário')
      return {
        user: { id: user.id, name: user.name, email: user.email, role: u.role, isPlatformOwner: user.isPlatformOwner },
        company: { id: company.id, name: company.name, cnpj: company.cnpj, status: company.status },
        impersonating: !!u.impersonating,
        permissions: req.perms,
        viewAs: u.readOnly ? { byName: u.viewAsByName ?? 'Administrador' } : null,
      }
    })

    // ---------------------------------------------------------- dashboard
    r.get('/api/dashboard', async (req) => {
      const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)
      return getDashboard(me(req).companyId, q.from, q.to, req.perms.projectIds)
    })

    // -------------------------------------------------------------- obras
    r.get('/api/projects', async (req) => {
      const { companyId } = me(req)
      const rows = (await db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(projects.code)).filter((p) => canProject(req.perms, p.id))
      const fin = await computeProjectFinancials(db, companyId)
      return rows.map((p) => ({ ...p, financials: fin.get(p.id) }))
    })

    r.get('/api/projects/:id', async (req) => {
      const { companyId } = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      requireProject(req, id)
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
      imageUrl: z
        .string()
        .refine((v) => /^https:\/\//.test(v) || (v.startsWith(MEDIA_PREFIX) && MEDIA_FILE.test(v.slice(MEDIA_PREFIX.length))), 'URL de imagem inválida')
        .optional()
        .nullable(),
      budgets: z.array(z.object({ category, amount: cents.nonnegative() })).optional(),
      // contrato com o proprietário (portal e prévia da medição)
      contractType: z.enum(['EMPREITADA', 'ADMINISTRACAO']).optional(),
      adminFeeBps: z.number().int().min(0).max(10_000).nullable().optional(),
      measurementDay: z.number().int().min(1).max(28).nullable().optional(),
      ownerPaysSuppliers: z.boolean().optional(),
      ownerName: z.string().max(120).nullable().optional(),
      ownerEmail: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
    })

    r.post('/api/projects', async (req, reply) => {
      const u = me(req)
      requireAction(req, 'editar_obras')
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

    // ----------------------------------------------- importação por planilha
    r.get('/api/projects/import/template.xlsx', async (req, reply) => {
      requireAction(req, 'editar_obras')
      const buf = await importTemplate(me(req).companyId)
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', 'attachment; filename="obras-operaia.xlsx"')
        .send(buf)
    })
    const importFile = async (req: FastifyRequest) => {
      requireAction(req, 'editar_obras')
      const [file] = await readUpload(req)
      if (!file) throw badRequest('SEM_ARQUIVO', 'Envie a planilha (.xlsx ou .csv).')
      if (file.content.length > 5 * 1024 * 1024) throw badRequest('ARQUIVO_GRANDE', 'Planilha maior que 5 MB.')
      return file
    }
    r.post('/api/projects/import/preview', async (req) => previewImport(me(req).companyId, await importFile(req), req.perms.projectIds))
    r.post('/api/projects/import', async (req) => {
      const u = me(req)
      return confirmImport(u.companyId, u.sub, await importFile(req), req.perms.projectIds)
    })

    r.patch('/api/projects/:id', async (req) => {
      const u = me(req)
      requireAction(req, 'editar_obras')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      requireProject(req, id)
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
            ...(body.contractType && { contractType: body.contractType }),
            ...(body.adminFeeBps !== undefined && { adminFeeBps: body.adminFeeBps }),
            ...(body.measurementDay !== undefined && { measurementDay: body.measurementDay }),
            ...(body.ownerPaysSuppliers !== undefined && { ownerPaysSuppliers: body.ownerPaysSuppliers }),
            ...(body.ownerName !== undefined && { ownerName: body.ownerName }),
            ...(body.ownerEmail !== undefined && { ownerEmail: body.ownerEmail }),
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

    r.post('/api/projects/:id/image', async (req) => {
      const u = me(req)
      requireAction(req, 'editar_obras')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      requireProject(req, id)
      const project = await db.query.projects.findFirst({ where: and(eq(projects.companyId, u.companyId), eq(projects.id, id)) })
      if (!project) throw notFound('Obra')
      if (!req.isMultipart()) throw badRequest('SEM_ARQUIVO', 'Envie a foto da obra.')
      const part = await req.file()
      if (!part) throw badRequest('SEM_ARQUIVO', 'Envie a foto da obra.')
      const content = await part.toBuffer()
      if (content.length > 5 * 1024 * 1024) throw badRequest('IMAGEM_GRANDE', 'A foto pode ter no máximo 5 MB.')
      const kind = imageKind(content)
      if (!kind) throw badRequest('IMAGEM_INVALIDA', 'Envie uma foto em JPG, PNG ou WEBP.')
      const file = `${randomBytes(16).toString('hex')}.${kind}`
      await storage().put(MEDIA_KEY(file), content, contentTypeOf(file))
      const imageUrl = MEDIA_PREFIX + file
      await db.update(projects).set({ imageUrl }).where(eq(projects.id, id))
      await removeOwnMedia(project.imageUrl)
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'project', entityId: id, action: 'image_updated', data: { imageUrl } })
      return { imageUrl }
    })

    r.delete('/api/projects/:id/image', async (req) => {
      const u = me(req)
      requireAction(req, 'editar_obras')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      requireProject(req, id)
      const project = await db.query.projects.findFirst({ where: and(eq(projects.companyId, u.companyId), eq(projects.id, id)) })
      if (!project) throw notFound('Obra')
      await db.update(projects).set({ imageUrl: null }).where(eq(projects.id, id))
      await removeOwnMedia(project.imageUrl)
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'project', entityId: id, action: 'image_removed', data: {} })
      return { imageUrl: null }
    })

    // -------------------------------------------------------- fornecedores
    r.get('/api/suppliers', async (req) => {
      const { companyId } = me(req)
      const q = z.object({ q: z.string().optional(), category: category.optional(), status: z.enum(['HOMOLOGADO', 'PENDENTE', 'BLOQUEADO']).optional() }).parse(req.query)
      const [summaries, delivery] = await Promise.all([getSupplierPriceSummaries(companyId), getDeliveryStats(companyId)])
      const list = await db
        .select({
          id: suppliers.id,
          cnpj: suppliers.cnpj,
          name: suppliers.name,
          tradeName: suppliers.tradeName,
          defaultCategory: suppliers.defaultCategory,
          status: suppliers.status,
          homologatedAt: suppliers.homologatedAt,
          homologatedBy: suppliers.homologatedBy,
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
            q.status ? eq(suppliers.status, q.status) : undefined,
            q.q
              ? normalizeCnpj(q.q)
                ? sql`(${suppliers.name} ILIKE ${'%' + q.q + '%'} OR ${suppliers.cnpj} LIKE ${'%' + normalizeCnpj(q.q) + '%'})`
                : sql`${suppliers.name} ILIKE ${'%' + q.q + '%'}`
              : undefined,
          ),
        )
        .orderBy(suppliers.name)
      return list.map((s) => ({ ...s, ...(summaries.get(s.id) ?? { avgPaymentTermDays: null, materials: 0, topItem: null }), delivery: delivery.get(s.id) ?? null }))
    })

    r.get('/api/suppliers/:id/prices', async (req) => {
      const { companyId } = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const supplier = await db.query.suppliers.findFirst({ where: and(eq(suppliers.companyId, companyId), eq(suppliers.id, id)) })
      if (!supplier) throw notFound('Fornecedor')
      const [prices, delivery] = await Promise.all([getSupplierPrices(companyId, id), getDeliveryStats(companyId)])
      return { ...prices, delivery: delivery.get(id) ?? null }
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
      const cnpj = normalizeCnpj(body.cnpj)
      if (!isValidCnpj(cnpj)) throw badRequest('CNPJ_INVALIDO', 'CNPJ inválido.')
      if (body.status && body.status !== 'PENDENTE') requireAction(req, 'homologar_fornecedores')
      const homologation = body.status === 'HOMOLOGADO' ? { homologatedAt: new Date(), homologatedBy: u.name } : {}
      const [s] = await db.insert(suppliers).values({ ...body, ...homologation, cnpj, companyId: u.companyId }).returning()
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'supplier', entityId: s.id, action: 'created', data: body })
      return reply.code(201).send(s)
    })

    r.patch('/api/suppliers/:id', async (req) => {
      const u = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = supplierBody.omit({ cnpj: true }).partial().parse(req.body)
      if (body.status) requireAction(req, 'homologar_fornecedores')
      const current = await db.query.suppliers.findFirst({ where: and(eq(suppliers.companyId, u.companyId), eq(suppliers.id, id)) })
      if (!current) throw notFound('Fornecedor')
      // registra quem e quando homologou; sair de homologado limpa o registro
      const homologation =
        body.status === 'HOMOLOGADO' && current.status !== 'HOMOLOGADO'
          ? { homologatedAt: new Date(), homologatedBy: u.name }
          : body.status && body.status !== 'HOMOLOGADO'
            ? { homologatedAt: null, homologatedBy: null }
            : {}
      const [s] = await db.update(suppliers).set({ ...body, ...homologation }).where(and(eq(suppliers.companyId, u.companyId), eq(suppliers.id, id))).returning()
      if (!s) throw notFound('Fornecedor')
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'supplier', entityId: id, action: 'updated', data: body })
      return s
    })

    // ------------------------------------------------------------- compras
    const orderBody = z.object({
      projectId: z.string().uuid(),
      supplierId: z.string().uuid(),
      category: category.optional(),
      expectedDate: ymd.optional().nullable(),
      paymentTerms: z.string().max(200).optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      items: z
        .array(z.object({ description: z.string().min(2).max(200), unit: z.string().max(10).optional().nullable(), quantity: z.number().positive(), unitPrice: z.number().nonnegative() }))
        .min(1)
        .max(200),
      requestId: z.string().uuid().optional().nullable(),
    })
    r.get('/api/purchase-orders', async (req) => {
      const q = z.object({ status: z.string().optional(), projectId: z.string().uuid().optional(), supplierId: z.string().uuid().optional() }).parse(req.query)
      if (q.projectId) requireProject(req, q.projectId)
      return listOrders(me(req).companyId, { ...q, scope: req.perms.projectIds })
    })
    r.get('/api/purchase-orders/:id', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      return getOrder(me(req).companyId, id)
    })
    r.post('/api/purchase-orders', async (req, reply) => {
      const u = me(req)
      const body = orderBody.parse(req.body)
      requireProject(req, body.projectId)
      return reply.code(201).send(await createOrder(u.companyId, { id: u.sub, name: u.name }, body))
    })
    r.patch('/api/purchase-orders/:id', async (req) => {
      const u = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = orderBody.partial().parse(req.body)
      if (body.projectId) requireProject(req, body.projectId)
      return updateOrder(u.companyId, u.sub, id, body)
    })
    r.post('/api/purchase-orders/:id/approve', async (req) => {
      const u = me(req)
      requireAction(req, 'aprovar_pedidos')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      return approveOrder(u.companyId, { id: u.sub, name: u.name }, id)
    })
    r.post('/api/purchase-orders/:id/cancel', async (req) => {
      const u = me(req)
      requireAction(req, 'aprovar_pedidos')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body)
      return cancelOrder(u.companyId, u.sub, id, reason)
    })
    r.post('/api/documents/:id/purchase-order', async (req) => {
      const u = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const { orderId } = z.object({ orderId: z.string().uuid().nullable() }).parse(req.body)
      if (orderId) await assertProjectRow('purchase_orders', orderId, req.perms.projectIds, 'Pedido')
      await linkDocumentToOrder(u.companyId, u.sub, id, orderId)
      return getDocument(u.companyId, id)
    })

    // ------------------------------------------------------- app de obra
    const fieldItems = z.array(z.object({ description: z.string().min(2).max(200), unit: z.string().max(10).optional().nullable(), quantity: z.number().positive() })).min(1).max(50)
    const uid = z.object({ id: z.string().uuid() })
    const fieldUser = (req: FastifyRequest) => ({ id: me(req).sub, name: me(req).name })
    /** hora em que aconteceu no canteiro (ISO); a API limita a agora e a 30 dias atrás */
    const happenedAt = z.string().datetime({ offset: true }).optional().nullable()

    // obras liberadas: projetos, e o projeto por trás de pedido, etapa e ocorrência
    const projectOf = async (table: 'purchase_orders' | 'project_stages' | 'occurrences', id: string) => {
      const { rows } = await db.execute<{ project_id: string }>(sql`SELECT project_id FROM ${sql.identifier(table)} WHERE id = ${id}`)
      return rows[0]?.project_id as string | undefined
    }
    r.addHook('preHandler', async (req) => {
      if (!req.url.startsWith('/api/field/') || !req.perms?.projectIds) return
      const id = (req.params as { id?: string })?.id
      if (!id || !/^[0-9a-f-]{36}$/.test(id)) return
      const path = req.url.split('?')[0]
      const projectId = path.startsWith('/api/field/projects/')
        ? id
        : path.startsWith('/api/field/orders/')
          ? await projectOf('purchase_orders', id)
          : path.startsWith('/api/field/stages/')
            ? await projectOf('project_stages', id)
            : path.startsWith('/api/field/occurrences/')
              ? await projectOf('occurrences', id)
              : undefined
      if (projectId) requireProject(req, projectId)
    })
    r.get('/api/field/projects', async (req) => (await fieldProjects(me(req).companyId)).filter((p) => canProject(req.perms, p.id)))
    r.get('/api/field/projects/:id', async (req) => fieldProject(me(req).companyId, uid.parse(req.params).id))
    r.post('/api/field/projects/:id/requests', async (req, reply) => {
      const body = z.object({ items: fieldItems, neededBy: ymd.optional().nullable(), urgent: z.boolean().optional(), notes: z.string().max(1000).optional().nullable(), happenedAt }).parse(req.body)
      return reply.code(201).send(await createMaterialRequest(me(req).companyId, fieldUser(req), uid.parse(req.params).id, body))
    })
    r.post('/api/field/orders/:id/receive', async (req, reply) => {
      const body = z
        .object({ items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().nonnegative() })).max(200), problem: z.boolean().optional(), notes: z.string().max(1000).optional().nullable(), happenedAt })
        .parse(req.body)
      return reply.code(201).send(await receiveDelivery(me(req).companyId, fieldUser(req), uid.parse(req.params).id, body))
    })
    r.post('/api/field/projects/:id/occurrences', async (req, reply) => {
      const body = z
        .object({
          type: z.enum(['FALTA_MATERIAL', 'ATRASO', 'SEGURANCA', 'QUALIDADE', 'CLIMA', 'ENTREGA', 'OUTRO']),
          severity: z.enum(['BAIXA', 'MEDIA', 'ALTA']),
          title: z.string().min(3).max(140),
          description: z.string().max(2000).optional().nullable(),
          happenedAt,
        })
        .parse(req.body)
      return reply.code(201).send(await createOccurrence(me(req).companyId, fieldUser(req), uid.parse(req.params).id, body))
    })
    r.post('/api/field/occurrences/:id/resolve', async (req) => {
      const { resolution } = z.object({ resolution: z.string().min(3).max(1000) }).parse(req.body)
      return resolveOccurrence(me(req).companyId, fieldUser(req), uid.parse(req.params).id, resolution)
    })
    r.post('/api/field/stages/:id/progress', async (req) => {
      const body = z.object({ progress: z.number().min(0).max(100), note: z.string().max(1000).optional().nullable(), happenedAt }).parse(req.body)
      return updateStageProgress(me(req).companyId, fieldUser(req), uid.parse(req.params).id, body)
    })
    /** Foto da obra: multipart com o arquivo e, opcionalmente, legenda e vínculo (ocorrência, entrega, avanço). */
    r.post('/api/field/projects/:id/photos', async (req, reply) => {
      const { id } = uid.parse(req.params)
      if (!req.isMultipart()) throw badRequest('SEM_ARQUIVO', 'Envie a foto.')
      const fields: Record<string, string> = {}
      let content: Buffer | null = null
      for await (const part of req.parts()) {
        if (part.type === 'file') content = await part.toBuffer()
        else fields[part.fieldname] = String(part.value ?? '')
      }
      if (!content) throw badRequest('SEM_ARQUIVO', 'Envie a foto.')
      if (content.length > 8 * 1024 * 1024) throw badRequest('IMAGEM_GRANDE', 'A foto pode ter no máximo 8 MB.')
      const kind = imageKind(content)
      if (!kind) throw badRequest('IMAGEM_INVALIDA', 'Envie uma foto em JPG, PNG ou WEBP.')
      const ref = z
        .object({ caption: z.string().max(300).optional(), occurrenceId: z.string().uuid().optional(), receiptId: z.string().uuid().optional(), stageUpdateId: z.string().uuid().optional(), happenedAt })
        .parse(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '')))
      const file = `${randomBytes(16).toString('hex')}.${kind}`
      await storage().put(MEDIA_KEY(file), content, contentTypeOf(file))
      try {
        return reply.code(201).send(await addSitePhoto(me(req).companyId, fieldUser(req), id, { url: MEDIA_PREFIX + file, fileSize: content.length, ...ref }))
      } catch (e) {
        await storage().delete(MEDIA_KEY(file)).catch(() => {})
        throw e
      }
    })

    // escritório: etapas da obra e solicitações de material
    r.put('/api/projects/:id/stages', async (req) => {
      requireAction(req, 'editar_obras')
      requireProject(req, uid.parse(req.params).id)
      const { stages } = z.object({ stages: z.array(z.object({ id: z.string().uuid().optional().nullable(), name: z.string().min(2).max(80), weight: z.number().min(1).max(1000) })).min(1).max(40) }).parse(req.body)
      return setStages(me(req).companyId, me(req).sub, uid.parse(req.params).id, stages)
    })
    r.get('/api/stage-templates', async () => DEFAULT_STAGES)
    r.get('/api/material-requests', async (req) => {
      const q = z.object({ status: z.string().optional() }).parse(req.query)
      return listMaterialRequests(me(req).companyId, q.status, req.perms.projectIds)
    })
    r.post('/api/material-requests/:id/decline', async (req) => {
      requireAction(req, 'aprovar_pedidos')
      const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body)
      return declineMaterialRequest(me(req).companyId, fieldUser(req), uid.parse(req.params).id, reason)
    })

    // --------------------------------------------------------- documentos
    r.get('/api/documents', async (req) => {
      const q = z.object({ status: z.string().optional(), projectId: z.string().uuid().optional(), q: z.string().optional() }).parse(req.query)
      if (q.projectId) requireProject(req, q.projectId)
      return listDocuments(me(req).companyId, { ...q, scope: req.perms.projectIds })
    })

    r.get('/api/documents/:id', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      return getDocument(me(req).companyId, id)
    })

    r.get('/api/documents/:id/file', async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const doc = await db.query.documents.findFirst({ where: and(eq(documents.companyId, me(req).companyId), eq(documents.id, id)) })
      if (!doc?.filePath) throw notFound('Arquivo')
      const content = await storage().get(doc.filePath)
      if (!content) throw notFound('Arquivo')
      reply.header('Content-Type', contentTypeOf(doc.fileName ?? ''))
      reply.header('Content-Disposition', `inline; filename="${(doc.fileName ?? 'documento').replace(/["\r\n]/g, '')}"`)
      return reply.send(content)
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
      if (body.suggestedProjectId) requireProject(req, body.suggestedProjectId)
      return updateDocumentDraft(u.companyId, u.sub, id, body)
    })

    r.post('/api/documents/:id/approve', async (req) => {
      const u = me(req)
      requireAction(req, 'aprovar_notas')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = z
        .object({
          allocations: z.array(z.object({ projectId: z.string().uuid(), category, amount: cents.positive() })).min(1),
          installments: z.array(z.object({ dueDate: ymd, amount: cents.positive() })).optional(),
          notes: z.string().optional(),
          acknowledgeCritical: z.boolean().optional(),
        })
        .parse(req.body)
      for (const a of body.allocations) requireProject(req, a.projectId)
      return approveDocument(u.companyId, u.sub, id, body)
    })

    r.post('/api/documents/:id/reject', async (req) => {
      const u = me(req)
      requireAction(req, 'aprovar_notas')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body)
      return rejectDocument(u.companyId, u.sub, id, reason)
    })

    r.post('/api/documents/:id/cancel', async (req) => {
      const u = me(req)
      requireAction(req, 'aprovar_notas')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body)
      return cancelDocument(u.companyId, u.sub, id, reason)
    })

    // ------------------------------------------------------ contas a pagar
    r.get('/api/payables', async (req) => {
      const q = z.object({ status: z.string().optional(), from: ymd.optional(), to: ymd.optional(), projectId: z.string().uuid().optional() }).parse(req.query)
      if (q.projectId) requireProject(req, q.projectId)
      return listPayables(me(req).companyId, { ...q, scope: req.perms.projectIds })
    })

    r.post('/api/payables/:id/payments', async (req) => {
      const u = me(req)
      requireAction(req, 'pagamentos')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = z.object({ amount: cents.positive(), paidAt: ymd, method: z.string().optional() }).parse(req.body)
      return registerPayment(u.companyId, u.sub, id, body)
    })

    r.get('/api/payables/:id/payments', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      return listPayments(me(req).companyId, id)
    })

    r.post('/api/payables/:id/payments/:paymentId/reverse', async (req) => {
      const u = me(req)
      requireAction(req, 'pagamentos')
      const { id, paymentId } = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() }).parse(req.params)
      const { reason } = z.object({ reason: z.string().trim().min(3, 'Diga o motivo do estorno.').max(500) }).parse(req.body)
      return reversePayment(u.companyId, u.sub, id, paymentId, reason)
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
        .where(and(eq(alerts.companyId, me(req).companyId), inArray(alerts.status, (q.status ?? 'ABERTO').split(',') as any), alertInScope(alerts.projectId, alerts.documentId, req.perms.projectIds)))
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
      const rows = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, permissions: users.permissions, active: users.active, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.companyId, me(req).companyId))
        .orderBy(users.name)
      return rows.map(({ permissions, ...x }) => ({ ...x, permissions: effectivePerms(x.role, permissions) }))
    })

    /** Padrão de cada perfil, para a tela de liberações. */
    r.get('/api/permissions/defaults', async (req) => {
      requireRole(req, 'ADMIN')
      return { screens: SCREENS, actions: ACTIONS, roles: ROLE_DEFAULTS }
    })

    /**
     * "Ver como": o administrador entra com as liberações da pessoa, só leitura, por até 1 hora.
     * Nada é gravado em nome dela (a API recusa qualquer alteração nesse modo).
     */
    r.post('/api/users/:id/view-as', async (req) => {
      requireRole(req, 'ADMIN')
      const u = me(req)
      if (u.readOnly) throw badRequest('JA_VENDO', 'Volte ao seu acesso antes de ver como outra pessoa.')
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      if (id === u.sub) throw badRequest('PROPRIO', 'Esse já é o seu acesso.')
      const target = await db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.companyId, u.companyId), eq(users.isPlatformOwner, false)) })
      if (!target) throw notFound('Usuário')
      if (!target.active) throw badRequest('INATIVO', 'Este acesso está desativado.')
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'user', entityId: id, action: 'view_as', data: { by: u.name } })
      const token = app.jwt.sign(
        { sub: target.id, companyId: u.companyId, role: target.role, name: target.name, readOnly: true, viewAsBy: u.sub, viewAsByName: u.name },
        { expiresIn: '1h' },
      )
      return { token }
    })

    /** Admin da construtora muda perfil ou desativa alguém da própria equipe */
    r.patch('/api/users/:id', async (req) => {
      requireRole(req, 'ADMIN')
      const u = me(req)
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
      const body = z
        .object({
          role: z.enum(['ADMIN', 'FINANCEIRO', 'GESTOR_OBRA', 'MESTRE']).optional(),
          active: z.boolean().optional(),
          // null volta ao padrão do perfil
          permissions: z
            .object({ screens: z.array(z.enum(SCREENS)).max(20), actions: z.array(z.enum(ACTIONS)).max(20), projectIds: z.array(z.string().uuid()).max(500).nullable() })
            .nullable()
            .optional(),
        })
        .parse(req.body)
      if (id === u.sub) throw badRequest('PROPRIO', 'Você não pode alterar o seu próprio perfil ou acesso.')
      if (body.permissions?.projectIds?.length) {
        const own = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, u.companyId), inArray(projects.id, body.permissions.projectIds)))
        if (own.length !== new Set(body.permissions.projectIds).size) throw badRequest('OBRA_INVALIDA', 'Obra não encontrada para esta construtora.')
      }
      const [row] = await db
        .update(users)
        .set(body)
        .where(and(eq(users.id, id), eq(users.companyId, u.companyId), eq(users.isPlatformOwner, false)))
        .returning({ id: users.id, role: users.role, active: users.active, permissions: users.permissions })
      if (!row) throw notFound('Usuário')
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'user', entityId: id, action: 'updated', data: body })
      return { ...row, permissions: effectivePerms(row.role, row.permissions) }
    })

    r.post('/api/users', async (req, reply) => {
      requireRole(req, 'ADMIN')
      const body = z
        .object({ name: z.string().min(2), email: z.string().email(), role: z.enum(['ADMIN', 'FINANCEIRO', 'GESTOR_OBRA', 'MESTRE']) })
        .parse(req.body)
      const res = await createUser({ ...body, companyId: me(req).companyId, createdBy: me(req).sub })
      // a senha provisória só é mostrada uma vez
      return reply.code(201).send(res)
    })

    // ---------------------------------------------------------- exportações
    r.get('/api/exports/payables.csv', async (req, reply) => {
      const q = z.object({ status: z.string().optional(), from: ymd.optional(), to: ymd.optional(), projectId: z.string().uuid().optional() }).parse(req.query)
      if (q.projectId) requireProject(req, q.projectId)
      const csv = await exportPayables(me(req).companyId, { ...q, scope: req.perms.projectIds })
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="contas-a-pagar-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv)
    })

    r.get('/api/reports', async (req) => {
      const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)
      return getReports(me(req).companyId, q.from, q.to, req.perms.projectIds)
    })

    r.get('/api/exports/relatorio-:kind.csv', async (req, reply) => {
      const { kind } = z.object({ kind: z.enum(['obras', 'fornecedores', 'meses']) }).parse(req.params)
      const q = z.object({ from: ymd.optional(), to: ymd.optional() }).parse(req.query)
      const csv = await exportReport(me(req).companyId, kind, q.from, q.to, req.perms.projectIds)
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="relatorio-${kind}-${q.from ?? 'inicio'}-a-${q.to ?? 'hoje'}.csv"`)
        .send(csv)
    })

    r.get('/api/exports/lancamentos.csv', async (req, reply) => {
      const q = z.object({ from: ymd.optional(), to: ymd.optional(), projectId: z.string().uuid().optional() }).parse(req.query)
      if (q.projectId) requireProject(req, q.projectId)
      const csv = await exportAllocations(me(req).companyId, { ...q, scope: req.perms.projectIds })
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="lancamentos-por-obra-${q.from ?? 'inicio'}-a-${q.to ?? 'hoje'}.csv"`)
        .send(csv)
    })

    r.get('/api/exports/notas-contador.zip', async (req, reply) => {
      const q = z.object({ from: ymd, to: ymd }).parse(req.query)
      if (q.to < q.from) throw badRequest('PERIODO_INVALIDO', 'A data final vem antes da inicial.')
      const u = me(req)
      const { zip, count } = await exportAccountantZip(u.companyId, { ...q, scope: req.perms.projectIds })
      await audit(db, { companyId: u.companyId, userId: u.sub, entity: 'export', entityId: u.companyId, action: 'accountant_zip', data: { ...q, count } })
      const name = q.from.slice(0, 7) === q.to.slice(0, 7) ? q.from.slice(0, 7) : `${q.from}-a-${q.to}`
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="notas-contador-${name}.zip"`)
        .header('X-Notas', String(count))
        .send(zip)
    })

    // ------------------------------------------------------ e-mail de notas
    const inboxBody = z.object({
      host: z.string().min(3),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      username: z.string().min(3),
      password: z.string().optional(),
      mailbox: z.string().optional(),
      enabled: z.boolean().optional(),
    })
    r.get('/api/mail-inbox', async (req) => {
      requireRole(req, 'ADMIN')
      return { inbox: await getInbox(me(req).companyId), providers: PROVIDERS }
    })
    r.put('/api/mail-inbox', async (req) => {
      requireRole(req, 'ADMIN')
      return saveInbox(me(req).companyId, me(req).sub, inboxBody.parse(req.body))
    })
    r.post('/api/mail-inbox/check', async (req) => {
      requireRole(req, 'ADMIN')
      const res = await checkInbox(me(req).companyId)
      return { result: res, inbox: await getInbox(me(req).companyId) }
    })
    r.post('/api/mail-inbox/:action', async (req) => {
      requireRole(req, 'ADMIN')
      const { action } = z.object({ action: z.enum(['pause', 'resume']) }).parse(req.params)
      return { inbox: await setInboxEnabled(me(req).companyId, me(req).sub, action === 'resume') }
    })
    r.delete('/api/mail-inbox', async (req) => {
      requireRole(req, 'ADMIN')
      await removeInbox(me(req).companyId, me(req).sub)
      return { inbox: null }
    })

    r.get('/api/integrations', async (req) => {
      requireRole(req, 'ADMIN')
      const company = await db.query.companies.findFirst({ where: eq(companies.id, me(req).companyId) })
      return { apiKey: company!.apiKey, nfeEndpoint: '/api/integrations/nfe' }
    })
  })
}
