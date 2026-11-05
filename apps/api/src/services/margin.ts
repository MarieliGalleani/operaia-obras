/**
 * Margem de contribuição por cliente (construtora) — métrica principal do plano de validação (meta ≥ 70%).
 *
 *   receita do mês        = mensalidade (a partir do mês de início da cobrança) ± ajuste do mês
 *   custos variáveis      = armazenamento (GB guardados × preço) + taxa do meio de pagamento
 *                           + suporte (minutos × custo da hora) + IA + outros
 *   margem de contribuição = receita − custos variáveis      (%: margem ÷ receita)
 *
 * Custos fixos (VPS, domínio, ferramentas) não entram na margem: aparecem só no resultado da
 * plataforma, junto com quantas construtoras pagantes cobrem esses fixos.
 * A implantação é receita única, mostrada à parte para não inflar a margem recorrente.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { companyMonthCosts, documents, platformSettings, sitePhotos, type PlatformCostSettings } from '../db/schema.js'
import { badRequest } from './errors.js'
import { storage } from './storage.js'

export const DEFAULT_COST_SETTINGS: PlatformCostSettings = {
  storagePerGbCents: 9, // Cloudflare R2: US$ 0,015/GB-mês ≈ R$ 0,09
  supportHourCents: 80_00,
  paymentFeeBps: 0,
  paymentFixedCents: 0,
  fixedMonthlyCents: 0,
  targetPct: 70,
}

/** Mensalidade sugerida por plano (hipótese do plano de negócio) */
export const PLAN_FEES: Record<string, number | null> = { PILOTO: null, ESSENCIAL: 399_00, PROFISSIONAL: 799_00, AVANCADO: 1_499_00, CORTESIA: 0 }

export async function getCostSettings(): Promise<PlatformCostSettings> {
  const row = await db.query.platformSettings.findFirst({ where: eq(platformSettings.id, 'default') })
  return { ...DEFAULT_COST_SETTINGS, ...(row?.data ?? {}) }
}

export async function saveCostSettings(patch: Partial<PlatformCostSettings>) {
  const data = { ...(await getCostSettings()), ...patch }
  await db
    .insert(platformSettings)
    .values({ id: 'default', data })
    .onConflictDoUpdate({ target: platformSettings.id, set: { data, updatedAt: new Date() } })
  return data
}

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
export const currentMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
/** Início e fim do mês no horário de Brasília */
function monthRange(m: string) {
  return { start: new Date(`${m}-01T00:00:00-03:00`), end: new Date(`${shiftMonth(m, 1)}-01T00:00:00-03:00`) }
}

/**
 * Arquivos gravados antes desta versão não têm o tamanho anotado: mede no armazenamento
 * (disco ou S3) e guarda. Limita por chamada para a tela não demorar; o resto mede na próxima.
 */
export async function measureMissingSizes(limit = 300) {
  const docs = await db
    .select({ id: documents.id, key: documents.filePath })
    .from(documents)
    .where(and(isNotNull(documents.filePath), isNull(documents.fileSize)))
    .limit(limit)
  const photos = await db
    .select({ id: sitePhotos.id, url: sitePhotos.url })
    .from(sitePhotos)
    .where(isNull(sitePhotos.fileSize))
    .limit(Math.max(0, limit - docs.length))
  const sizeOf = async (key: string) => (await storage().size(key).catch(() => null)) ?? 0
  for (const d of docs) await db.update(documents).set({ fileSize: await sizeOf(d.key!) }).where(eq(documents.id, d.id))
  for (const p of photos) {
    const file = p.url.split('/').pop() ?? ''
    await db.update(sitePhotos).set({ fileSize: file ? await sizeOf(`media/obras/${file}`) : 0 }).where(eq(sitePhotos.id, p.id))
  }
  const [{ n }] = (
    await db.execute(sql`SELECT
      (SELECT count(*) FROM fiscal_documents WHERE file_path IS NOT NULL AND file_size IS NULL) +
      (SELECT count(*) FROM site_photos WHERE file_size IS NULL) AS n`)
  ).rows as { n: string }[]
  return { measured: docs.length + photos.length, remaining: Number(n) }
}

export type MarginStatus = 'OK' | 'ABAIXO' | 'NEGATIVA' | 'SEM_RECEITA'

export interface MarginRow {
  companyId: string
  name: string
  status: 'ATIVA' | 'SUSPENSA'
  plan: string | null
  billingSince: string | null
  /** mensalidade cobrada no mês, já com o ajuste */
  revenue: number
  setupRevenue: number
  costs: { storage: number; payment: number; support: number; ai: number; other: number }
  variableCosts: number
  margin: number
  marginPct: number | null
  marginStatus: MarginStatus
  usage: { storageBytes: number; documentsInMonth: number; usersActive: number; supportSessions: number }
  manual: { supportMinutes: number; aiCost: number; otherCost: number; revenueAdjust: number; notes: string | null }
}

async function rowsFor(month: string, settings: PlatformCostSettings): Promise<MarginRow[]> {
  const { start, end } = monthRange(month)
  const { rows } = await db.execute(sql`
    SELECT c.id, c.name, c.status, c.plan, c.monthly_fee, c.setup_fee, c.billing_since, c.suspended_at, c.created_at,
      (SELECT coalesce(sum(d.file_size), 0) FROM fiscal_documents d WHERE d.company_id = c.id AND d.created_at < ${end})
        + (SELECT coalesce(sum(p.file_size), 0) FROM site_photos p WHERE p.company_id = c.id AND p.created_at < ${end}) AS storage_bytes,
      (SELECT count(*) FROM fiscal_documents d WHERE d.company_id = c.id AND d.created_at >= ${start} AND d.created_at < ${end}) AS docs_month,
      (SELECT count(*) FROM users u WHERE u.company_id = c.id AND u.active) AS users_active,
      (SELECT count(*) FROM audit_logs a WHERE a.company_id = c.id AND a.action = 'support_session_started' AND a.created_at >= ${start} AND a.created_at < ${end}) AS support_sessions,
      m.support_minutes, m.ai_cost, m.other_cost, m.revenue_adjust, m.notes
    FROM companies c
    LEFT JOIN company_month_costs m ON m.company_id = c.id AND m.month = ${month}
    -- entra no mês se já existia ou se a cobrança começou antes do cadastro (cliente migrado)
    WHERE c.created_at < ${end} OR c.billing_since <= ${month}
    ORDER BY c.name`)

  return rows.map((r: any) => {
    const since: string = r.billing_since ?? new Date(r.created_at).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
    const suspendedBefore = r.status === 'SUSPENSA' && r.suspended_at && new Date(r.suspended_at) < start
    const billing = r.plan !== 'CORTESIA' && month >= since && !suspendedBefore
    const fee = billing ? Number(r.monthly_fee ?? 0) : 0
    const manual = {
      supportMinutes: Number(r.support_minutes ?? 0),
      aiCost: Number(r.ai_cost ?? 0),
      otherCost: Number(r.other_cost ?? 0),
      revenueAdjust: Number(r.revenue_adjust ?? 0),
      notes: (r.notes as string | null) ?? null,
    }
    const revenue = Math.max(0, fee + manual.revenueAdjust)
    const storageBytes = Number(r.storage_bytes ?? 0)
    const costs = {
      storage: Math.round((storageBytes / 1e9) * settings.storagePerGbCents),
      payment: revenue > 0 ? Math.round((revenue * settings.paymentFeeBps) / 10_000) + settings.paymentFixedCents : 0,
      support: Math.round((manual.supportMinutes / 60) * settings.supportHourCents),
      ai: manual.aiCost,
      other: manual.otherCost,
    }
    const variableCosts = costs.storage + costs.payment + costs.support + costs.ai + costs.other
    const margin = revenue - variableCosts
    const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null
    const marginStatus: MarginStatus = revenue <= 0 ? 'SEM_RECEITA' : margin < 0 ? 'NEGATIVA' : marginPct! >= settings.targetPct ? 'OK' : 'ABAIXO'
    return {
      companyId: r.id,
      name: r.name,
      status: r.status,
      plan: r.plan ?? null,
      billingSince: r.billing_since ?? null,
      revenue,
      setupRevenue: billing && month === since ? Number(r.setup_fee ?? 0) : 0,
      costs,
      variableCosts,
      margin,
      marginPct,
      marginStatus,
      usage: { storageBytes, documentsInMonth: Number(r.docs_month), usersActive: Number(r.users_active), supportSessions: Number(r.support_sessions) },
      manual,
    }
  })
}

function totalsOf(rows: MarginRow[], settings: PlatformCostSettings) {
  const paying = rows.filter((r) => r.revenue > 0)
  const revenue = rows.reduce((a, r) => a + r.revenue, 0)
  const variableCosts = rows.reduce((a, r) => a + r.variableCosts, 0)
  const margin = revenue - variableCosts
  // construtoras sem receita (piloto gratuito, cortesia) entram no custo: é o que custam para a plataforma
  const avgPayingMargin = paying.length ? paying.reduce((a, r) => a + r.margin, 0) / paying.length : 0
  return {
    revenue,
    setupRevenue: rows.reduce((a, r) => a + r.setupRevenue, 0),
    variableCosts,
    margin,
    marginPct: revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null,
    payingCompanies: paying.length,
    belowTarget: paying.filter((r) => r.marginStatus !== 'OK').length,
    fixedCosts: settings.fixedMonthlyCents,
    result: margin - settings.fixedMonthlyCents,
    /** quantas pagantes, com a margem média de hoje, cobrem os custos fixos */
    breakEvenCompanies: settings.fixedMonthlyCents > 0 && avgPayingMargin > 0 ? Math.ceil(settings.fixedMonthlyCents / avgPayingMargin) : null,
  }
}

export async function getMargin(month = currentMonth()) {
  if (!MONTH.test(month)) throw badRequest('MES_INVALIDO', 'Mês no formato AAAA-MM.')
  const files = await measureMissingSizes()
  const settings = await getCostSettings()
  const rows = await rowsFor(month, settings)
  const trend = []
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(month, -i)
    const t = i === 0 ? totalsOf(rows, settings) : totalsOf(await rowsFor(m, settings), settings)
    trend.push({ month: m, revenue: t.revenue, margin: t.margin, marginPct: t.marginPct, payingCompanies: t.payingCompanies })
  }
  return { month, settings, rows, totals: totalsOf(rows, settings), trend, filesToMeasure: files.remaining }
}

export async function saveMonthCosts(
  companyId: string,
  month: string,
  input: { supportMinutes?: number; aiCost?: number; otherCost?: number; revenueAdjust?: number; notes?: string | null },
) {
  if (!MONTH.test(month)) throw badRequest('MES_INVALIDO', 'Mês no formato AAAA-MM.')
  const set = { ...input, updatedAt: new Date() }
  const [row] = await db
    .insert(companyMonthCosts)
    .values({ companyId, month, ...input })
    .onConflictDoUpdate({ target: [companyMonthCosts.companyId, companyMonthCosts.month], set })
    .returning()
  return row
}
