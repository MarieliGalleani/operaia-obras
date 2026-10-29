/**
 * Fluxo de documentos: Recebimento → Leitura → Validação → Vínculo → Registro.
 * A IA (futuro) pode sugerir; quem registra é este serviço, com regras determinísticas e auditoria.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm'
import { db, type Tx } from '../db/client.js'
import {
  alerts,
  allocations,
  companies,
  documentItems,
  documents,
  payables,
  payments,
  projects,
  suppliers,
  type CostCategory,
  type Issue,
} from '../db/schema.js'
import { findProjectInText, suggestCategory } from '../domain/classifier.js'
import { formatCnpj, isValidAccessKey, isValidCnpj, onlyDigits } from '../domain/cnpj.js'
import { formatBRL } from '../domain/money.js'
import { NfeParseError, parseNfeXml, type ParsedNfe } from '../domain/nfe-parser.js'
import { evaluateBudgetAlerts, evaluatePriceAlerts, raiseAlert, resolveAlerts } from './alerts.js'
import { audit } from './audit.js'
import { badRequest, conflict, notFound } from './errors.js'

const STORAGE_DIR = process.env.STORAGE_DIR ?? './storage'
const DEFAULT_TERM_DAYS = 30

type Source = 'UPLOAD' | 'EMAIL' | 'API' | 'MANUAL'

export interface IngestResult {
  status: 'CRIADO' | 'JA_IMPORTADO'
  documentId: string
  document: Awaited<ReturnType<typeof getDocument>>
}

async function storeFile(companyId: string, fileName: string, content: Buffer) {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  const dir = path.join(STORAGE_DIR, companyId, new Date().toISOString().slice(0, 7))
  await mkdir(dir, { recursive: true })
  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(-80)
  const filePath = path.join(dir, `${hash}-${safe}`)
  await writeFile(filePath, content)
  return filePath
}

/** Entrada única para XML de NF-e (upload, e-mail via n8n ou API). */
export async function ingestNfeXml(params: {
  companyId: string
  userId?: string | null
  fileName: string
  content: Buffer
  source: Source
}): Promise<IngestResult> {
  let nfe: ParsedNfe
  try {
    nfe = parseNfeXml(params.content)
  } catch (e) {
    if (e instanceof NfeParseError) throw badRequest('XML_INVALIDO', e.message)
    throw e
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, params.companyId))
  if (!company) throw notFound('Construtora')

  // Reenvio da mesma nota (mesma chave) não cria nada novo
  if (nfe.accessKey) {
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.companyId, params.companyId), eq(documents.accessKey, nfe.accessKey)))
    if (existing) return { status: 'JA_IMPORTADO', documentId: existing.id, document: await getDocument(params.companyId, existing.id) }
  }

  const filePath = await storeFile(params.companyId, params.fileName, params.content)

  const documentId = await db.transaction(async (tx) => {
    const issues: Issue[] = []

    // --- fornecedor ---------------------------------------------------------
    let supplier = null as null | typeof suppliers.$inferSelect
    if (nfe.issuer.cnpj) {
      ;[supplier] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.companyId, params.companyId), eq(suppliers.cnpj, nfe.issuer.cnpj)))
      if (!supplier) {
        ;[supplier] = await tx
          .insert(suppliers)
          .values({
            companyId: params.companyId,
            cnpj: nfe.issuer.cnpj,
            name: nfe.issuer.name ?? formatCnpj(nfe.issuer.cnpj),
            tradeName: nfe.issuer.tradeName,
            status: 'PENDENTE',
          })
          .returning()
        issues.push({ code: 'FORNECEDOR_NOVO', severity: 'INFO', message: `Fornecedor ${supplier!.name} cadastrado automaticamente (pendente de homologação).` })
      }
      if (supplier!.status === 'BLOQUEADO') {
        issues.push({ code: 'FORNECEDOR_BLOQUEADO', severity: 'CRITICO', message: `Fornecedor ${supplier!.name} está bloqueado.` })
      }
    }

    // --- validações determinísticas ----------------------------------------
    if (!nfe.accessKey || !isValidAccessKey(nfe.accessKey)) {
      issues.push({ code: 'CHAVE_INVALIDA', severity: 'CRITICO', message: 'Chave de acesso ausente ou com dígito verificador inválido.' })
    }
    if (!nfe.issuer.cnpj || !isValidCnpj(nfe.issuer.cnpj)) {
      issues.push({ code: 'CNPJ_EMITENTE_INVALIDO', severity: 'CRITICO', message: 'CNPJ do emitente ausente ou inválido.' })
    }
    if (nfe.recipient.cnpj !== onlyDigits(company.cnpj)) {
      issues.push({
        code: 'DESTINATARIO_DIVERGENTE',
        severity: 'CRITICO',
        message: `Nota emitida para ${nfe.recipient.cnpj ? formatCnpj(nfe.recipient.cnpj) : 'destinatário sem CNPJ'}, não para ${formatCnpj(company.cnpj)}.`,
      })
    }
    if (!nfe.authorized) {
      issues.push({ code: 'SEM_PROTOCOLO', severity: 'ATENCAO', message: 'XML sem protocolo de autorização da SEFAZ. Confirme a autorização antes de pagar.' })
    }
    if (nfe.totalCents <= 0) {
      issues.push({ code: 'VALOR_ZERADO', severity: 'CRITICO', message: 'Valor total da nota é zero.' })
    }
    const itemsSum = nfe.items.reduce((a, b) => a + b.totalCents, 0)
    if (nfe.productsCents && Math.abs(itemsSum - nfe.productsCents) > 1) {
      issues.push({ code: 'SOMA_ITENS', severity: 'ATENCAO', message: `Soma dos itens (${formatBRL(itemsSum)}) difere do total de produtos (${formatBRL(nfe.productsCents)}).` })
    }
    const instSum = nfe.installments.reduce((a, b) => a + b.amountCents, 0)
    if (nfe.installments.length && Math.abs(instSum - nfe.totalCents) > 1) {
      issues.push({ code: 'SOMA_PARCELAS', severity: 'ATENCAO', message: `Soma das parcelas (${formatBRL(instSum)}) difere do total da nota (${formatBRL(nfe.totalCents)}). Ajuste os vencimentos na aprovação.` })
    }
    if (!nfe.installments.length) {
      issues.push({ code: 'SEM_PARCELAS', severity: 'INFO', message: `Nota sem duplicatas. Sugerido vencimento único em ${DEFAULT_TERM_DAYS} dias — confirme na aprovação.` })
    }

    // --- possível duplicidade (mesma nota com outra chave, ou mesma cobrança) --
    let duplicateOf: { id: string; number: string | null } | null = null
    if (supplier) {
      const issue = nfe.issueDate ? new Date(nfe.issueDate) : new Date()
      const candidates = await tx
        .select({ id: documents.id, number: documents.number, totalAmount: documents.totalAmount, issueDate: documents.issueDate })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, params.companyId),
            eq(documents.supplierId, supplier.id),
            notInArray(documents.status, ['REJEITADO', 'CANCELADO']),
          ),
        )
      duplicateOf =
        candidates.find((c) => c.number && c.number === nfe.number) ??
        candidates.find(
          (c) =>
            c.totalAmount === nfe.totalCents &&
            c.issueDate &&
            Math.abs(c.issueDate.getTime() - issue.getTime()) <= 3 * 86400000,
        ) ??
        null
      if (duplicateOf) {
        issues.push({
          code: 'POSSIVEL_DUPLICIDADE',
          severity: 'CRITICO',
          message: `Possível duplicidade com a NF ${duplicateOf.number ?? '(sem número)'} do mesmo fornecedor já lançada.`,
        })
      }
    }

    // --- sugestão de obra e categoria --------------------------------------
    const activeProjects = await tx
      .select({ id: projects.id, code: projects.code, name: projects.name })
      .from(projects)
      .where(and(eq(projects.companyId, params.companyId), eq(projects.status, 'ATIVA')))
    let match = findProjectInText([nfe.extraInfo, nfe.purchaseOrder].filter(Boolean).join(' '), activeProjects)
    let suggestionReason = match?.reason ?? null
    let explicit = !!match

    if (!match && supplier) {
      // histórico: se o fornecedor só abasteceu uma obra nos últimos 60 dias, sugere (mas pede revisão)
      const recent = await tx
        .selectDistinct({ projectId: allocations.projectId })
        .from(allocations)
        .innerJoin(documents, eq(documents.id, allocations.documentId))
        .where(
          and(
            eq(documents.companyId, params.companyId),
            eq(documents.supplierId, supplier.id),
            eq(documents.status, 'APROVADO'),
            gte(documents.issueDate, new Date(Date.now() - 60 * 86400000)),
          ),
        )
      if (recent.length === 1) {
        const p = activeProjects.find((x) => x.id === recent[0].projectId)
        if (p) {
          match = { project: p, reason: 'única obra atendida por este fornecedor nos últimos 60 dias' }
          suggestionReason = match.reason
        }
      }
    }
    if (!explicit) {
      issues.push({
        code: 'OBRA_NAO_IDENTIFICADA',
        severity: 'ATENCAO',
        message: match ? `Obra sugerida pelo histórico (${match.project.name}). Confirme antes de aprovar.` : 'A nota não informa a obra. Selecione a obra na revisão.',
      })
    }

    const cat = suggestCategory({ supplierDefault: supplier?.defaultCategory, operation: nfe.operation, items: nfe.items })

    const needsReview = issues.some((i) => i.severity !== 'INFO')
    const [doc] = await tx
      .insert(documents)
      .values({
        companyId: params.companyId,
        supplierId: supplier?.id ?? null,
        type: 'NFE',
        source: params.source,
        status: needsReview ? 'EM_REVISAO' : 'RECEBIDO',
        accessKey: nfe.accessKey,
        number: nfe.number,
        series: nfe.series,
        issueDate: nfe.issueDate ? new Date(nfe.issueDate) : null,
        totalAmount: nfe.totalCents,
        recipientCnpj: nfe.recipient.cnpj,
        description: summarizeItems(nfe),
        extraInfo: nfe.extraInfo,
        category: cat.category,
        fileName: params.fileName,
        filePath,
        raw: nfe as any,
        issues,
        suggestedProjectId: match?.project.id ?? null,
        suggestionReason: suggestionReason ? `${suggestionReason}; categoria: ${cat.reason}` : `categoria: ${cat.reason}`,
        createdById: params.userId ?? null,
      })
      .returning({ id: documents.id })

    if (nfe.items.length) {
      await tx.insert(documentItems).values(
        nfe.items.map((it) => ({
          documentId: doc.id,
          code: it.code,
          description: it.description,
          ncm: it.ncm,
          cfop: it.cfop,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.totalCents,
        })),
      )
    }

    // --- alertas derivados -------------------------------------------------
    if (duplicateOf) {
      await raiseAlert(tx, {
        companyId: params.companyId,
        type: 'DUPLICIDADE',
        severity: 'CRITICO',
        fingerprint: `dup:${doc.id}`,
        documentId: doc.id,
        supplierId: supplier?.id,
        title: 'Nota duplicada identificada',
        message: `NF ${nfe.number} de ${supplier?.name} parece repetir a NF ${duplicateOf.number} já lançada.`,
      })
    }
    if (issues.some((i) => i.code === 'DESTINATARIO_DIVERGENTE')) {
      await raiseAlert(tx, {
        companyId: params.companyId,
        type: 'DESTINATARIO',
        severity: 'CRITICO',
        fingerprint: `dest:${doc.id}`,
        documentId: doc.id,
        supplierId: supplier?.id,
        title: 'Nota emitida para outro CNPJ',
        message: `NF ${nfe.number} de ${supplier?.name ?? 'fornecedor'} não foi emitida para a construtora.`,
      })
    }
    if (!explicit) {
      await raiseAlert(tx, {
        companyId: params.companyId,
        type: 'OBRA_NAO_IDENTIFICADA',
        severity: 'INFO',
        fingerprint: `noproject:${doc.id}`,
        documentId: doc.id,
        supplierId: supplier?.id,
        title: 'Nota sem obra identificada',
        message: `NF ${nfe.number} de ${supplier?.name ?? 'fornecedor'} (${formatBRL(nfe.totalCents)}) aguarda definição da obra.`,
      })
    }
    await evaluatePriceAlerts(tx, params.companyId, doc.id)

    await audit(tx, {
      companyId: params.companyId,
      userId: params.userId,
      entity: 'document',
      entityId: doc.id,
      action: 'imported',
      data: { source: params.source, fileName: params.fileName, issues: issues.map((i) => i.code) },
    })
    return doc.id
  })

  return { status: 'CRIADO', documentId, document: await getDocument(params.companyId, documentId) }
}

/** PDF/imagem/recibo: guarda o arquivo e abre um documento para preenchimento manual. */
export async function ingestManualFile(params: { companyId: string; userId?: string | null; fileName: string; content: Buffer; source: Source }) {
  const filePath = await storeFile(params.companyId, params.fileName, params.content)
  const [doc] = await db
    .insert(documents)
    .values({
      companyId: params.companyId,
      type: 'OUTRO',
      source: params.source,
      status: 'EM_REVISAO',
      fileName: params.fileName,
      filePath,
      issues: [{ code: 'DADOS_MANUAIS', severity: 'ATENCAO', message: 'Arquivo sem XML: preencha fornecedor, número, data e valor.' }],
      createdById: params.userId ?? null,
    })
    .returning({ id: documents.id })
  await audit(db, { companyId: params.companyId, userId: params.userId, entity: 'document', entityId: doc.id, action: 'uploaded_file', data: { fileName: params.fileName } })
  return { status: 'CRIADO' as const, documentId: doc.id, document: await getDocument(params.companyId, doc.id) }
}

function summarizeItems(nfe: ParsedNfe) {
  if (!nfe.items.length) return null
  const first = nfe.items[0].description
  return nfe.items.length === 1 ? first : `${first} e mais ${nfe.items.length - 1} item(ns)`
}

export async function getDocument(companyId: string, id: string) {
  const doc = await db.query.documents.findFirst({ where: and(eq(documents.companyId, companyId), eq(documents.id, id)) })
  if (!doc) throw notFound('Documento')
  const [items, allocs, pays, supplier, docAlerts] = await Promise.all([
    db.select().from(documentItems).where(eq(documentItems.documentId, id)),
    db
      .select({ id: allocations.id, projectId: allocations.projectId, projectName: projects.name, category: allocations.category, amount: allocations.amount })
      .from(allocations)
      .innerJoin(projects, eq(projects.id, allocations.projectId))
      .where(eq(allocations.documentId, id)),
    db.select().from(payables).where(eq(payables.documentId, id)).orderBy(payables.dueDate),
    doc.supplierId ? db.query.suppliers.findFirst({ where: eq(suppliers.id, doc.supplierId) }) : null,
    db.select().from(alerts).where(and(eq(alerts.documentId, id), eq(alerts.status, 'ABERTO'))),
  ])
  const { raw, filePath, ...rest } = doc
  const parsed = raw as ParsedNfe | null
  return {
    ...rest,
    hasFile: !!filePath,
    installmentsFromXml: parsed?.installments ?? [],
    issuer: parsed?.issuer ?? null,
    supplier: supplier ?? null,
    items,
    allocations: allocs,
    payables: pays,
    alerts: docAlerts,
  }
}

export async function listDocuments(companyId: string, filters: { status?: string; projectId?: string; q?: string }) {
  const where = [eq(documents.companyId, companyId)]
  if (filters.status) where.push(inArray(documents.status, filters.status.split(',') as any))
  if (filters.projectId) {
    where.push(sql`(${documents.suggestedProjectId} = ${filters.projectId} OR EXISTS (SELECT 1 FROM allocations a WHERE a.document_id = ${documents.id} AND a.project_id = ${filters.projectId}))`)
  }
  if (filters.q) {
    const q = `%${filters.q}%`
    where.push(sql`(${documents.number} ILIKE ${q} OR ${suppliers.name} ILIKE ${q} OR ${documents.description} ILIKE ${q} OR ${documents.accessKey} ILIKE ${q})`)
  }
  return db
    .select({
      id: documents.id,
      type: documents.type,
      status: documents.status,
      source: documents.source,
      number: documents.number,
      issueDate: documents.issueDate,
      totalAmount: documents.totalAmount,
      description: documents.description,
      category: documents.category,
      supplierId: documents.supplierId,
      supplierName: suppliers.name,
      suggestedProjectId: documents.suggestedProjectId,
      issues: documents.issues,
      createdAt: documents.createdAt,
      projectNames: sql<string | null>`(SELECT string_agg(DISTINCT p.name, ', ') FROM allocations a JOIN projects p ON p.id = a.project_id WHERE a.document_id = ${documents.id})`,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(and(...where))
    .orderBy(desc(documents.createdAt))
    .limit(200)
}

/** Edição de dados enquanto o documento não foi aprovado (necessário para PDFs/recibos). */
export async function updateDocumentDraft(
  companyId: string,
  userId: string,
  id: string,
  patch: {
    supplierCnpj?: string
    supplierName?: string
    number?: string
    issueDate?: string
    totalAmount?: number
    description?: string
    category?: CostCategory
    suggestedProjectId?: string | null
  },
) {
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
    if (!doc) throw notFound('Documento')
    if (!['RECEBIDO', 'EM_REVISAO'].includes(doc.status)) throw conflict('STATUS_INVALIDO', 'Só é possível editar documentos ainda não aprovados.')

    const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() }
    if (patch.supplierCnpj) {
      const cnpj = onlyDigits(patch.supplierCnpj)
      if (!isValidCnpj(cnpj)) throw badRequest('CNPJ_INVALIDO', 'CNPJ do fornecedor inválido.')
      let [s] = await tx.select().from(suppliers).where(and(eq(suppliers.companyId, companyId), eq(suppliers.cnpj, cnpj)))
      if (!s) {
        ;[s] = await tx.insert(suppliers).values({ companyId, cnpj, name: patch.supplierName ?? formatCnpj(cnpj) }).returning()
      }
      set.supplierId = s.id
    }
    if (patch.number !== undefined) set.number = patch.number
    if (patch.issueDate) set.issueDate = new Date(patch.issueDate)
    if (patch.totalAmount !== undefined) {
      if (doc.type === 'NFE') throw badRequest('VALOR_XML', 'O valor de uma NF-e vem do XML e não pode ser alterado.')
      set.totalAmount = patch.totalAmount
    }
    if (patch.description !== undefined) set.description = patch.description
    if (patch.category) set.category = patch.category
    if (patch.suggestedProjectId !== undefined) set.suggestedProjectId = patch.suggestedProjectId

    // documento manual: limpa a pendência de dados quando o essencial foi preenchido
    const merged = { ...doc, ...set }
    if (doc.type !== 'NFE' && merged.supplierId && merged.totalAmount && merged.issueDate) {
      set.issues = (doc.issues ?? []).filter((i) => i.code !== 'DADOS_MANUAIS')
    }
    await tx.update(documents).set(set).where(eq(documents.id, id))
    await audit(tx, { companyId, userId, entity: 'document', entityId: id, action: 'edited', data: patch })
  }).then(() => getDocument(companyId, id))
}

export interface ApproveInput {
  allocations: Array<{ projectId: string; category: CostCategory; amount: number }>
  installments?: Array<{ dueDate: string; amount: number }>
  notes?: string
  /** Obrigatório quando há pendência crítica: o usuário declara que conferiu */
  acknowledgeCritical?: boolean
}

export async function approveDocument(companyId: string, userId: string, id: string, input: ApproveInput) {
  const affectedProjects = await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, id))).for('update')
    if (!doc) throw notFound('Documento')
    if (!['RECEBIDO', 'EM_REVISAO'].includes(doc.status)) throw conflict('STATUS_INVALIDO', `Documento está ${doc.status}.`)
    if (!doc.supplierId) throw badRequest('SEM_FORNECEDOR', 'Informe o fornecedor antes de aprovar.')
    if (!doc.totalAmount || doc.totalAmount <= 0) throw badRequest('SEM_VALOR', 'Informe o valor antes de aprovar.')
    if (!doc.issueDate) throw badRequest('SEM_DATA', 'Informe a data de emissão antes de aprovar.')

    const critical = (doc.issues ?? []).filter((i) => i.severity === 'CRITICO')
    if (critical.length && !input.acknowledgeCritical) {
      throw conflict('PENDENCIA_CRITICA', 'Há pendências críticas. Confirme que conferiu antes de aprovar.', critical)
    }
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, doc.supplierId))
    if (supplier?.status === 'BLOQUEADO') throw conflict('FORNECEDOR_BLOQUEADO', 'Fornecedor bloqueado: não é possível aprovar.')

    // apropriação: soma tem que bater com o total, obras precisam ser da construtora
    if (!input.allocations?.length) throw badRequest('SEM_APROPRIACAO', 'Informe ao menos uma obra para apropriar o custo.')
    const allocSum = input.allocations.reduce((a, b) => a + b.amount, 0)
    if (allocSum !== doc.totalAmount) {
      throw badRequest('APROPRIACAO_DIVERGENTE', `A soma das apropriações (${formatBRL(allocSum)}) precisa ser igual ao total (${formatBRL(doc.totalAmount)}).`)
    }
    if (input.allocations.some((a) => a.amount <= 0)) throw badRequest('APROPRIACAO_INVALIDA', 'Valores de apropriação devem ser positivos.')
    const projectIds = [...new Set(input.allocations.map((a) => a.projectId))]
    const owned = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds)))
    if (owned.length !== projectIds.length) throw badRequest('OBRA_INVALIDA', 'Obra não encontrada para esta construtora.')

    // títulos: usa o informado; senão as duplicatas do XML; senão vencimento padrão
    const parsed = doc.raw as ParsedNfe | null
    let installments = input.installments?.length
      ? input.installments
      : parsed?.installments?.length
        ? parsed.installments.map((i) => ({ dueDate: i.dueDate, amount: i.amountCents }))
        : [{ dueDate: addDays(doc.issueDate, DEFAULT_TERM_DAYS), amount: doc.totalAmount }]
    const instSum = installments.reduce((a, b) => a + b.amount, 0)
    if (instSum !== doc.totalAmount) {
      throw badRequest('PARCELAS_DIVERGENTES', `A soma das parcelas (${formatBRL(instSum)}) precisa ser igual ao total (${formatBRL(doc.totalAmount)}).`)
    }
    if (installments.some((i) => !/^\d{4}-\d{2}-\d{2}$/.test(i.dueDate) || i.amount <= 0)) {
      throw badRequest('PARCELA_INVALIDA', 'Parcelas precisam de data (AAAA-MM-DD) e valor positivo.')
    }

    await tx.insert(allocations).values(input.allocations.map((a) => ({ documentId: id, projectId: a.projectId, category: a.category, amount: a.amount })))
    await tx.insert(payables).values(
      installments.map((inst, i) => ({
        companyId,
        documentId: id,
        supplierId: doc.supplierId,
        installment: installments.length > 1 ? `${i + 1}/${installments.length}` : 'única',
        dueDate: new Date(`${inst.dueDate}T12:00:00-03:00`),
        amount: inst.amount,
      })),
    )
    await tx
      .update(documents)
      .set({
        status: 'APROVADO',
        approvedById: userId,
        approvedAt: new Date(),
        reviewNotes: input.notes ?? doc.reviewNotes,
        category: input.allocations[0].category,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))

    await resolveAlerts(tx, companyId, [`noproject:${id}`, `dest:${id}`, `dup:${id}`])
    await audit(tx, {
      companyId,
      userId,
      entity: 'document',
      entityId: id,
      action: 'approved',
      data: { allocations: input.allocations, installments, acknowledgedCritical: critical.map((c) => c.code) },
    })
    return projectIds
  })

  await db.transaction((tx) => evaluateBudgetAlerts(tx, companyId, affectedProjects))
  return getDocument(companyId, id)
}

export async function rejectDocument(companyId: string, userId: string, id: string, reason: string) {
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
    if (!doc) throw notFound('Documento')
    if (!['RECEBIDO', 'EM_REVISAO'].includes(doc.status)) throw conflict('STATUS_INVALIDO', `Documento está ${doc.status}.`)
    await tx.update(documents).set({ status: 'REJEITADO', reviewNotes: reason, updatedAt: new Date() }).where(eq(documents.id, id))
    await tx.update(alerts).set({ status: 'RESOLVIDO', resolvedAt: new Date() }).where(and(eq(alerts.documentId, id), eq(alerts.status, 'ABERTO')))
    await audit(tx, { companyId, userId, entity: 'document', entityId: id, action: 'rejected', data: { reason } })
  })
  return getDocument(companyId, id)
}

/** Cancela uma nota aprovada (ex.: NF cancelada pelo fornecedor). Bloqueado se já houve pagamento. */
export async function cancelDocument(companyId: string, userId: string, id: string, reason: string) {
  const projectIds = await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.id, id))).for('update')
    if (!doc) throw notFound('Documento')
    if (doc.status !== 'APROVADO') throw conflict('STATUS_INVALIDO', 'Só notas aprovadas podem ser canceladas.')
    const pays = await tx.select().from(payables).where(eq(payables.documentId, id))
    if (pays.some((p) => p.paidAmount > 0)) {
      throw conflict('POSSUI_PAGAMENTO', 'Há pagamentos registrados. Estorne os pagamentos antes de cancelar a nota.')
    }
    const allocs = await tx.select({ projectId: allocations.projectId }).from(allocations).where(eq(allocations.documentId, id))
    await tx.delete(allocations).where(eq(allocations.documentId, id))
    await tx.update(payables).set({ status: 'CANCELADO' }).where(eq(payables.documentId, id))
    await tx.update(documents).set({ status: 'CANCELADO', reviewNotes: reason, updatedAt: new Date() }).where(eq(documents.id, id))
    await audit(tx, { companyId, userId, entity: 'document', entityId: id, action: 'cancelled', data: { reason, removedAllocations: allocs.length } })
    return [...new Set(allocs.map((a) => a.projectId))]
  })
  await db.transaction((tx) => evaluateBudgetAlerts(tx, companyId, projectIds))
  return getDocument(companyId, id)
}

// ---------------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------------

export async function listPayables(companyId: string, filters: { status?: string; from?: string; to?: string; projectId?: string }) {
  const where = [eq(payables.companyId, companyId)]
  where.push(inArray(payables.status, (filters.status ?? 'ABERTO,PARCIAL').split(',') as any))
  if (filters.from) where.push(gte(payables.dueDate, new Date(`${filters.from}T00:00:00-03:00`)))
  if (filters.to) where.push(lte(payables.dueDate, new Date(`${filters.to}T23:59:59-03:00`)))
  if (filters.projectId) where.push(sql`EXISTS (SELECT 1 FROM allocations a WHERE a.document_id = ${payables.documentId} AND a.project_id = ${filters.projectId})`)
  return db
    .select({
      id: payables.id,
      documentId: payables.documentId,
      installment: payables.installment,
      dueDate: payables.dueDate,
      amount: payables.amount,
      paidAmount: payables.paidAmount,
      status: payables.status,
      supplierName: suppliers.name,
      documentNumber: documents.number,
      description: documents.description,
      projectNames: sql<string | null>`(SELECT string_agg(DISTINCT p.name, ', ') FROM allocations a JOIN projects p ON p.id = a.project_id WHERE a.document_id = ${payables.documentId})`,
    })
    .from(payables)
    .innerJoin(documents, eq(documents.id, payables.documentId))
    .leftJoin(suppliers, eq(suppliers.id, payables.supplierId))
    .where(and(...where))
    .orderBy(payables.dueDate)
    .limit(500)
}

/** Registra pagamento (total ou parcial). Não movimenta dinheiro: apenas registra o que foi pago fora do sistema. */
export async function registerPayment(companyId: string, userId: string, payableId: string, input: { amount: number; paidAt: string; method?: string }) {
  const projectIds = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payables).where(and(eq(payables.companyId, companyId), eq(payables.id, payableId))).for('update')
    if (!p) throw notFound('Título')
    if (!['ABERTO', 'PARCIAL'].includes(p.status)) throw conflict('STATUS_INVALIDO', `Título está ${p.status}.`)
    const remaining = p.amount - p.paidAmount
    if (input.amount <= 0 || input.amount > remaining) {
      throw badRequest('VALOR_INVALIDO', `Valor deve ser maior que zero e no máximo ${formatBRL(remaining)}.`)
    }
    const paidAmount = p.paidAmount + input.amount
    await tx.insert(payments).values({ payableId, amount: input.amount, paidAt: new Date(input.paidAt), method: input.method, createdById: userId })
    await tx.update(payables).set({ paidAmount, status: paidAmount === p.amount ? 'PAGO' : 'PARCIAL' }).where(eq(payables.id, payableId))
    await audit(tx, { companyId, userId, entity: 'payable', entityId: payableId, action: 'payment_registered', data: input })
    const allocs = await tx.select({ projectId: allocations.projectId }).from(allocations).where(eq(allocations.documentId, p.documentId))
    return [...new Set(allocs.map((a) => a.projectId))]
  })
  await db.transaction((tx) => evaluateBudgetAlerts(tx, companyId, projectIds))
  const [updated] = await db.select().from(payables).where(eq(payables.id, payableId))
  return updated
}

export function addDays(date: Date, days: number): string {
  const d = new Date(date.getTime() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

