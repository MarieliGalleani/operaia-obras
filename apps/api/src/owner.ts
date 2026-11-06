/**
 * Portal do proprietário (dono da obra): "espelho da obra", só leitura, só das obras liberadas.
 * O bloqueio de qualquer outra rota está no gancho de permissões (ownerApiAllowed).
 *
 * Também ficam aqui as rotas da construtora para configurar o contrato da obra, ver a prévia
 * da medição e liberar o acesso do proprietário.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AuthUser } from './app.js'
import { db } from './db/client.js'
import { companies, documents, projectStages, sitePhotos, users } from './db/schema.js'
import { createUser } from './services/accounts.js'
import { audit } from './services/audit.js'
import { conflict, forbidden, notFound } from './services/errors.js'
import { physicalProgress } from './services/field.js'
import { getMeasurement, projectsSummary } from './services/measurement.js'
import { canProject } from './services/permissions.js'
import { contentTypeOf, storage } from './services/storage.js'

const me = (req: FastifyRequest) => req.user as AuthUser
const uid = z.object({ id: z.string().uuid() })
const monthQ = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM').optional() })

/** Obra liberada para este proprietário? (404 para não revelar que a obra existe) */
function ownerProject(req: FastifyRequest, projectId: string) {
  if (!req.perms.projectIds?.includes(projectId)) throw notFound('Obra')
}

export async function registerOwnerRoutes(r: FastifyInstance) {
  // ============================================================ portal (perfil PROPRIETARIO)
  r.get('/api/owner/projects', async (req) => projectsSummary(me(req).companyId, req.perms.projectIds ?? []))

  r.get('/api/owner/projects/:id', async (req) => {
    const { id } = uid.parse(req.params)
    ownerProject(req, id)
    const { companyId, sub } = me(req)
    const user = await db.query.users.findFirst({ where: eq(users.id, sub) })
    const [measurement, stages, photos, recent] = await Promise.all([
      getMeasurement(companyId, id),
      db.select().from(projectStages).where(eq(projectStages.projectId, id)).orderBy(projectStages.sortOrder),
      // fotos do andamento (ocorrências internas ficam de fora)
      db
        .select({ id: sitePhotos.id, url: sitePhotos.url, caption: sitePhotos.caption, createdAt: sitePhotos.createdAt })
        .from(sitePhotos)
        .where(and(eq(sitePhotos.projectId, id), isNull(sitePhotos.occurrenceId)))
        .orderBy(desc(sitePhotos.createdAt))
        .limit(24),
      db.execute(sql`
        SELECT d.id, d.type, d.number, d.issue_date, d.approved_at, s.name AS supplier, sum(a.amount)::bigint AS amount,
          string_agg(DISTINCT a.category::text, ',') AS categories, d.file_name IS NOT NULL AS has_file
        FROM allocations a JOIN fiscal_documents d ON d.id = a.document_id LEFT JOIN suppliers s ON s.id = d.supplier_id
        WHERE a.project_id = ${id} AND d.company_id = ${companyId} AND d.status = 'APROVADO'
        GROUP BY d.id, s.name ORDER BY d.approved_at DESC NULLS LAST LIMIT 30`),
    ])
    const seenAt = user?.ownerSeenAt ?? null
    const [{ cost }] = (
      await db.execute(sql`SELECT coalesce(sum(a.amount), 0)::bigint AS cost FROM allocations a JOIN fiscal_documents d ON d.id = a.document_id
        WHERE a.project_id = ${id} AND d.status = 'APROVADO'`)
    ).rows as { cost: string }[]
    const docs = recent.rows.map((d: any) => ({
      id: d.id,
      type: d.type,
      number: d.number,
      issueDate: d.issue_date,
      approvedAt: d.approved_at,
      supplier: d.supplier,
      amount: Number(d.amount),
      categories: String(d.categories ?? '').split(',').filter(Boolean),
      hasFile: d.has_file,
      isNew: !!seenAt && !!d.approved_at && new Date(d.approved_at) > seenAt,
    }))
    return {
      project: measurement.project,
      contract: measurement.contract,
      costToDate: Number(cost),
      physicalPct: physicalProgress(stages),
      stages: stages.map((s) => ({ name: s.name, progress: s.progress, updatedAt: s.updatedAt })),
      measurement,
      documents: docs,
      photos,
      news: { since: seenAt, documents: seenAt ? docs.filter((d) => d.isNew).length : 0, firstVisit: !seenAt },
    }
  })

  r.get('/api/owner/projects/:id/measurement', async (req) => {
    const { id } = uid.parse(req.params)
    ownerProject(req, id)
    return getMeasurement(me(req).companyId, id, monthQ.parse(req.query).month)
  })

  /** Marca as novidades como vistas */
  r.post('/api/owner/seen', async (req) => {
    if (me(req).readOnly) return { ok: true }
    await db.update(users).set({ ownerSeenAt: new Date() }).where(eq(users.id, me(req).sub))
    return { ok: true }
  })

  /** XML/PDF de uma nota aprovada de uma obra liberada */
  r.get('/api/owner/documents/:id/file', async (req, reply) => {
    const { id } = uid.parse(req.params)
    const { companyId } = me(req)
    const doc = await db.query.documents.findFirst({ where: and(eq(documents.companyId, companyId), eq(documents.id, id), eq(documents.status, 'APROVADO')) })
    if (!doc?.filePath) throw notFound('Arquivo')
    const ids = req.perms.projectIds ?? []
    const { rows } = ids.length
      ? await db.execute(sql`SELECT 1 FROM allocations WHERE document_id = ${id} AND project_id = ANY(${`{${ids.join(',')}}`}::uuid[]) LIMIT 1`)
      : { rows: [] }
    if (!rows.length) throw notFound('Arquivo')
    const content = await storage().get(doc.filePath)
    if (!content) throw notFound('Arquivo')
    reply.header('Content-Type', contentTypeOf(doc.fileName ?? ''))
    reply.header('Content-Disposition', `inline; filename="${(doc.fileName ?? 'documento').replace(/["\r\n]/g, '')}"`)
    return reply.send(content)
  })

  // ============================================================ construtora
  const requireProject = (req: FastifyRequest, id: string) => {
    if (!canProject(req.perms, id)) throw notFound('Obra')
  }
  const requireAdmin = (req: FastifyRequest) => {
    if (me(req).role !== 'ADMIN') throw forbidden('Só o administrador libera acesso ao proprietário.')
  }

  r.get('/api/projects/:id/measurement', async (req) => {
    const { id } = uid.parse(req.params)
    requireProject(req, id)
    return getMeasurement(me(req).companyId, id, monthQ.parse(req.query).month)
  })

  /** Proprietários com acesso a esta obra */
  r.get('/api/projects/:id/owners', async (req) => {
    const { id } = uid.parse(req.params)
    requireProject(req, id)
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email, active: users.active, lastLoginAt: users.lastLoginAt, permissions: users.permissions })
      .from(users)
      .where(and(eq(users.companyId, me(req).companyId), eq(users.role, 'PROPRIETARIO')))
    return rows.filter((u) => u.permissions?.projectIds?.includes(id)).map(({ permissions, ...u }) => ({ ...u, projects: permissions?.projectIds?.length ?? 0 }))
  })

  /** Libera o portal: cria o login do proprietário (senha provisória mostrada uma vez) ou soma a obra a quem já tem */
  r.post('/api/projects/:id/owners', async (req, reply) => {
    requireAdmin(req)
    const { id } = uid.parse(req.params)
    requireProject(req, id)
    const { companyId, sub } = me(req)
    const body = z.object({ name: z.string().min(2), email: z.string().email() }).parse(req.body)
    const email = body.email.trim().toLowerCase()
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
    if (existing) {
      if (existing.companyId !== companyId || existing.role !== 'PROPRIETARIO') throw conflict('EMAIL_EM_USO', `O e-mail ${email} já tem outro tipo de acesso.`)
      const projectIds = [...new Set([...(existing.permissions?.projectIds ?? []), id])]
      await db.update(users).set({ permissions: { projectIds }, active: true }).where(eq(users.id, existing.id))
      await audit(db, { companyId, userId: sub, entity: 'user', entityId: existing.id, action: 'owner_project_added', data: { projectId: id } })
      return reply.code(200).send({ user: { id: existing.id, name: existing.name, email: existing.email }, password: null })
    }
    const res = await createUser({ companyId, name: body.name, email, role: 'PROPRIETARIO', createdBy: sub })
    await db.update(users).set({ permissions: { projectIds: [id] } }).where(eq(users.id, res.user.id))
    await audit(db, { companyId, userId: sub, entity: 'user', entityId: res.user.id, action: 'owner_project_added', data: { projectId: id } })
    return reply.code(201).send(res)
  })

  /** Tira a obra do proprietário (sem obras, o acesso fica desativado) */
  r.delete('/api/projects/:id/owners/:userId', async (req) => {
    requireAdmin(req)
    const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params)
    requireProject(req, id)
    const { companyId, sub } = me(req)
    const u = await db.query.users.findFirst({ where: and(eq(users.id, userId), eq(users.companyId, companyId), eq(users.role, 'PROPRIETARIO')) })
    if (!u) throw notFound('Proprietário')
    const projectIds = (u.permissions?.projectIds ?? []).filter((p) => p !== id)
    await db.update(users).set({ permissions: { projectIds }, ...(projectIds.length ? {} : { active: false }) }).where(eq(users.id, userId))
    await audit(db, { companyId, userId: sub, entity: 'user', entityId: userId, action: 'owner_project_removed', data: { projectId: id } })
    return { ok: true, active: projectIds.length > 0 }
  })

  /** Padrões das obras por administração (Configurações) */
  r.get('/api/company/contract-defaults', async (req) => {
    const c = await db.query.companies.findFirst({ where: eq(companies.id, me(req).companyId) })
    return { adminFeeBps: c!.defaultAdminFeeBps, measurementDay: c!.defaultMeasurementDay }
  })
  r.put('/api/company/contract-defaults', async (req) => {
    if (me(req).role !== 'ADMIN') throw forbidden('Só o administrador muda os padrões.')
    const body = z.object({ adminFeeBps: z.number().int().min(0).max(10_000), measurementDay: z.number().int().min(1).max(28).nullable() }).parse(req.body)
    await db.update(companies).set({ defaultAdminFeeBps: body.adminFeeBps, defaultMeasurementDay: body.measurementDay }).where(eq(companies.id, me(req).companyId))
    await audit(db, { companyId: me(req).companyId, userId: me(req).sub, entity: 'company', entityId: me(req).companyId, action: 'contract_defaults_updated', data: body })
    return body
  })
}

