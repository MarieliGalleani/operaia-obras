/**
 * OperaIA Obras — modelo de dados do MVP
 *
 * Regras de modelagem:
 * - Todo registro de negócio pertence a uma construtora (companyId). Toda consulta filtra por ele.
 * - Valores monetários em CENTAVOS (bigint, mode number) — sem ponto flutuante em dinheiro.
 * - Nota fiscal ≠ título a pagar ≠ pagamento ≠ custo apropriado. São tabelas diferentes.
 */
import {
  bigint,
  boolean,
  integer,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', ['ADMIN', 'FINANCEIRO', 'GESTOR_OBRA', 'MESTRE'])
export const projectStatus = pgEnum('project_status', ['ATIVA', 'PAUSADA', 'CONCLUIDA'])
export const costCategory = pgEnum('cost_category', [
  'MATERIAIS',
  'MAO_DE_OBRA',
  'TERCEIRIZADOS',
  'EQUIPAMENTOS',
  'SERVICOS',
  'OUTROS',
])
export const supplierStatus = pgEnum('supplier_status', ['HOMOLOGADO', 'PENDENTE', 'BLOQUEADO'])
export const documentType = pgEnum('document_type', ['NFE', 'NFSE', 'RECIBO', 'OUTRO'])
export const documentSource = pgEnum('document_source', ['UPLOAD', 'EMAIL', 'API', 'MANUAL'])
/**
 * RECEBIDO   – entrou e passou nas validações, pronto para aprovar
 * EM_REVISAO – precisa de ação humana (obra não identificada, divergência, dados faltando)
 * APROVADO   – custo apropriado e títulos gerados
 */
export const documentStatus = pgEnum('document_status', [
  'RECEBIDO',
  'EM_REVISAO',
  'APROVADO',
  'REJEITADO',
  'CANCELADO',
])
export const payableStatus = pgEnum('payable_status', ['ABERTO', 'PARCIAL', 'PAGO', 'CANCELADO'])
export const alertType = pgEnum('alert_type', [
  'ORCAMENTO',
  'DUPLICIDADE',
  'PRECO',
  'DADOS',
  'DESTINATARIO',
  'OBRA_NAO_IDENTIFICADA',
  'VENCIMENTO',
  'ECONOMIA',
  'PEDIDO',
  'OCORRENCIA',
])
/**
 * RASCUNHO – montando o pedido, ainda não foi para o fornecedor
 * APROVADO – liberado para o fornecedor, aguardando entrega
 * PARCIAL  – parte dos itens já chegou (nota aprovada)
 * ATENDIDO – tudo entregue
 */
export const purchaseOrderStatus = pgEnum('purchase_order_status', ['RASCUNHO', 'APROVADO', 'PARCIAL', 'ATENDIDO', 'CANCELADO'])
export const alertSeverity = pgEnum('alert_severity', ['CRITICO', 'ATENCAO', 'INFO', 'OPORTUNIDADE'])
export const alertStatus = pgEnum('alert_status', ['ABERTO', 'RESOLVIDO', 'IGNORADO'])
export const companyStatus = pgEnum('company_status', ['ATIVA', 'SUSPENSA'])

const money = (name: string) => bigint(name, { mode: 'number' })
const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  cnpj: text('cnpj').notNull().unique(),
  /** Chave para integrações (n8n, e-mail) enviarem XMLs */
  apiKey: text('api_key').notNull().unique(),
  /** SUSPENSA: ninguém da construtora entra e a integração recusa notas (dados preservados) */
  status: companyStatus('status').notNull().default('ATIVA'),
  /** Anotações internas da OperaIA (plano, piloto, contato) — a construtora não vê */
  notes: text('notes'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const users = pgTable(
  'users',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('FINANCEIRO'),
    active: boolean('active').notNull().default(true),
    /** Dona(o) da plataforma OperaIA: vê e administra todas as construtoras */
    isPlatformOwner: boolean('is_platform_owner').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('users_company_idx').on(t.companyId)],
)

export const projects = pgTable(
  'projects',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    status: projectStatus('status').notNull().default('ATIVA'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    budgetTotal: money('budget_total').notNull(),
    imageUrl: text('image_url'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('projects_company_code_uq').on(t.companyId, t.code)],
)

export const projectBudgets = pgTable(
  'project_budgets',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    category: costCategory('category').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('project_budgets_uq').on(t.projectId, t.category)],
)

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    cnpj: text('cnpj').notNull(),
    name: text('name').notNull(),
    tradeName: text('trade_name'),
    defaultCategory: costCategory('default_category'),
    status: supplierStatus('status').notNull().default('PENDENTE'),
    homologatedAt: timestamp('homologated_at', { withTimezone: true }),
    homologatedBy: text('homologated_by'),
    email: text('email'),
    phone: text('phone'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('suppliers_company_cnpj_uq').on(t.companyId, t.cnpj)],
)

export const documents = pgTable(
  'fiscal_documents',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    type: documentType('type').notNull().default('NFE'),
    source: documentSource('source').notNull().default('UPLOAD'),
    status: documentStatus('status').notNull().default('RECEBIDO'),
    accessKey: text('access_key'),
    number: text('number'),
    series: text('series'),
    issueDate: timestamp('issue_date', { withTimezone: true }),
    totalAmount: money('total_amount'),
    recipientCnpj: text('recipient_cnpj'),
    description: text('description'),
    extraInfo: text('extra_info'),
    category: costCategory('category'),
    fileName: text('file_name'),
    filePath: text('file_path'),
    raw: jsonb('raw'),
    /** Pendências encontradas na validação */
    issues: jsonb('issues').$type<Issue[]>().notNull().default([]),
    suggestedProjectId: uuid('suggested_project_id').references(() => projects.id),
    suggestionReason: text('suggestion_reason'),
    /** Pedido de compra que esta nota atende (opcional: nota sem pedido pode ser aprovada, com aviso) */
    purchaseOrderId: uuid('purchase_order_id').references((): any => purchaseOrders.id, { onDelete: 'set null' }),
    reviewNotes: text('review_notes'),
    createdById: uuid('created_by_id'),
    approvedById: uuid('approved_by_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('documents_company_key_uq').on(t.companyId, t.accessKey),
    index('documents_company_status_idx').on(t.companyId, t.status),
    index('documents_supplier_number_idx').on(t.companyId, t.supplierId, t.number),
  ],
)

export type Issue = { code: string; severity: 'CRITICO' | 'ATENCAO' | 'INFO'; message: string }

export const documentItems = pgTable(
  'document_items',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    code: text('code'),
    description: text('description').notNull(),
    ncm: text('ncm'),
    cfop: text('cfop'),
    unit: text('unit'),
    quantity: numeric('quantity', { precision: 16, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 16, scale: 4 }).notNull(),
    total: money('total').notNull(),
  },
  (t) => [index('document_items_doc_idx').on(t.documentId)],
)

/** Apropriação do custo de um documento em obra + categoria. Várias linhas = rateio. */
export const allocations = pgTable(
  'allocations',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    category: costCategory('category').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [index('allocations_project_idx').on(t.projectId), index('allocations_doc_idx').on(t.documentId)],
)

export const payables = pgTable(
  'payables',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    installment: text('installment').notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    amount: money('amount').notNull(),
    paidAmount: money('paid_amount').notNull().default(0),
    status: payableStatus('status').notNull().default('ABERTO'),
    createdAt: createdAt(),
  },
  (t) => [index('payables_company_status_due_idx').on(t.companyId, t.status, t.dueDate)],
)

export const payments = pgTable('payments', {
  id: id(),
  payableId: uuid('payable_id')
    .notNull()
    .references(() => payables.id, { onDelete: 'cascade' }),
  amount: money('amount').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  method: text('method'),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
})

export const alerts = pgTable(
  'alerts',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    type: alertType('type').notNull(),
    severity: alertSeverity('severity').notNull(),
    status: alertStatus('status').notNull().default('ABERTO'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    /** Identifica o fato que gerou o alerta, para não repetir */
    fingerprint: text('fingerprint').notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('alerts_company_fingerprint_uq').on(t.companyId, t.fingerprint),
    index('alerts_company_status_idx').on(t.companyId, t.status),
  ],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_company_entity_idx').on(t.companyId, t.entity, t.entityId)],
)

/** Pedido de compra: o que foi combinado com o fornecedor antes da nota chegar. */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Número sequencial por construtora (PC-0001); é o que o fornecedor deve informar na nota (xPed) */
    number: integer('number').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    status: purchaseOrderStatus('status').notNull().default('RASCUNHO'),
    category: costCategory('category').notNull().default('MATERIAIS'),
    /** Data de entrega prometida pelo fornecedor */
    expectedDate: timestamp('expected_date', { withTimezone: true }),
    paymentTerms: text('payment_terms'),
    notes: text('notes'),
    total: money('total').notNull().default(0),
    createdById: uuid('created_by_id'),
    createdByName: text('created_by_name'),
    approvedById: uuid('approved_by_id'),
    approvedByName: text('approved_by_name'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('purchase_orders_company_number_uq').on(t.companyId, t.number),
    index('purchase_orders_company_status_idx').on(t.companyId, t.status),
    index('purchase_orders_supplier_idx').on(t.companyId, t.supplierId),
  ],
)

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    unit: text('unit'),
    quantity: numeric('quantity', { precision: 16, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 16, scale: 4 }).notNull(),
    total: money('total').notNull(),
  },
  (t) => [index('purchase_order_items_order_idx').on(t.orderId)],
)

// ------------------------------------------------------------------ campo (app de obra)
export const materialRequestStatus = pgEnum('material_request_status', ['ABERTA', 'EM_COMPRA', 'RECUSADA'])
export const occurrenceType = pgEnum('occurrence_type', ['FALTA_MATERIAL', 'ATRASO', 'SEGURANCA', 'QUALIDADE', 'CLIMA', 'ENTREGA', 'OUTRO'])
export const occurrenceSeverity = pgEnum('occurrence_severity', ['BAIXA', 'MEDIA', 'ALTA'])
export const occurrenceStatus = pgEnum('occurrence_status', ['ABERTA', 'RESOLVIDA'])

export type FieldItem = { description: string; unit: string | null; quantity: number }

/** Pedido de material feito pelo mestre na obra; o escritório transforma em pedido de compra. */
export const materialRequests = pgTable(
  'material_requests',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    status: materialRequestStatus('status').notNull().default('ABERTA'),
    items: jsonb('items').$type<FieldItem[]>().notNull(),
    neededBy: timestamp('needed_by', { withTimezone: true }),
    urgent: boolean('urgent').notNull().default(false),
    notes: text('notes'),
    orderId: uuid('order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
    declineReason: text('decline_reason'),
    createdById: uuid('created_by_id'),
    createdByName: text('created_by_name'),
    handledByName: text('handled_by_name'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('material_requests_company_status_idx').on(t.companyId, t.status), index('material_requests_project_idx').on(t.projectId)],
)

/** Recebimento conferido na obra (o que chegou de fato no canteiro). */
export const deliveryReceipts = pgTable(
  'delivery_receipts',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    items: jsonb('items').$type<Array<FieldItem & { orderItemId: string }>>().notNull(),
    /** chegou com problema (avaria, faltou, material errado): abre ocorrência */
    problem: boolean('problem').notNull().default(false),
    notes: text('notes'),
    receivedById: uuid('received_by_id'),
    receivedByName: text('received_by_name'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('delivery_receipts_order_idx').on(t.orderId), index('delivery_receipts_project_idx').on(t.projectId)],
)

export const occurrences = pgTable(
  'occurrences',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    type: occurrenceType('type').notNull(),
    severity: occurrenceSeverity('severity').notNull().default('MEDIA'),
    status: occurrenceStatus('status').notNull().default('ABERTA'),
    title: text('title').notNull(),
    description: text('description'),
    receiptId: uuid('receipt_id').references(() => deliveryReceipts.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id'),
    createdByName: text('created_by_name'),
    resolution: text('resolution'),
    resolvedByName: text('resolved_by_name'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('occurrences_project_idx').on(t.projectId), index('occurrences_company_status_idx').on(t.companyId, t.status)],
)

/** Etapas da obra com peso e % concluído (avanço físico). */
export const projectStages = pgTable(
  'project_stages',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** peso da etapa no avanço total (ex.: % do orçamento que ela representa) */
    weight: integer('weight').notNull().default(1),
    progress: integer('progress').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    updatedByName: text('updated_by_name'),
  },
  (t) => [index('project_stages_project_idx').on(t.projectId)],
)

export const stageUpdates = pgTable(
  'stage_updates',
  {
    id: id(),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => projectStages.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromProgress: integer('from_progress').notNull(),
    progress: integer('progress').notNull(),
    note: text('note'),
    userId: uuid('user_id'),
    userName: text('user_name'),
    createdAt: createdAt(),
  },
  (t) => [index('stage_updates_project_idx').on(t.projectId)],
)

/** Fotos da obra: diário, ocorrência, entrega ou avanço. Arquivo com nome aleatório em storage/media/obras. */
export const sitePhotos = pgTable(
  'site_photos',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    url: text('url').notNull(),
    caption: text('caption'),
    occurrenceId: uuid('occurrence_id').references(() => occurrences.id, { onDelete: 'set null' }),
    receiptId: uuid('receipt_id').references(() => deliveryReceipts.id, { onDelete: 'set null' }),
    stageUpdateId: uuid('stage_update_id').references(() => stageUpdates.id, { onDelete: 'set null' }),
    userId: uuid('user_id'),
    userName: text('user_name'),
    createdAt: createdAt(),
  },
  (t) => [index('site_photos_project_idx').on(t.projectId, t.createdAt)],
)

export type CostCategory = (typeof costCategory.enumValues)[number]
export const COST_CATEGORIES = costCategory.enumValues

/** Caixa de e-mail de notas de cada construtora (lida automaticamente pelo sistema) */
export const mailInboxes = pgTable('mail_inboxes', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .unique()
    .references(() => companies.id, { onDelete: 'cascade' }),
  host: text('host').notNull(),
  port: integer('port').notNull().default(993),
  secure: boolean('secure').notNull().default(true),
  username: text('username').notNull(),
  /** senha criptografada (AES-256-GCM); nunca volta para a tela */
  passwordEnc: text('password_enc').notNull(),
  mailbox: text('mailbox').notNull().default('INBOX'),
  enabled: boolean('enabled').notNull().default(true),
  lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  messagesProcessed: integer('messages_processed').notNull().default(0),
  documentsReceived: integer('documents_received').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
