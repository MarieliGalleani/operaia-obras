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

export const userRole = pgEnum('user_role', ['ADMIN', 'FINANCEIRO', 'GESTOR_OBRA'])
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
])
export const alertSeverity = pgEnum('alert_severity', ['CRITICO', 'ATENCAO', 'INFO', 'OPORTUNIDADE'])
export const alertStatus = pgEnum('alert_status', ['ABERTO', 'RESOLVIDO', 'IGNORADO'])

const money = (name: string) => bigint(name, { mode: 'number' })
const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  cnpj: text('cnpj').notNull().unique(),
  /** Chave para integrações (n8n, e-mail) enviarem XMLs */
  apiKey: text('api_key').notNull().unique(),
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

export type CostCategory = (typeof costCategory.enumValues)[number]
export const COST_CATEGORIES = costCategory.enumValues
