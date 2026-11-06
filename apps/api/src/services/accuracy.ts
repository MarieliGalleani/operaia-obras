/**
 * Relatório de acerto das sugestões (área da dona). Ver domain/accuracy.ts para a regra.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { ACCURACY_TARGET, CRITICAL_FIELDS, rate, type CheckField } from '../domain/accuracy.js'

const FIELDS: CheckField[] = ['obra', 'categoria', 'vencimento', 'pedido', 'fornecedor', 'valor', 'numero', 'emissao']

type Counts = { acertou: number; errou: number; semSugestao: number }
const empty = (): Counts => ({ acertou: 0, errou: 0, semSugestao: 0 })
const add = (c: Counts, outcome: string, n: number) => {
  if (outcome === 'ACERTOU') c.acertou += n
  else if (outcome === 'ERROU') c.errou += n
  else c.semSugestao += n
}
const summary = (c: Counts) => ({
  ...c,
  total: c.acertou + c.errou + c.semSugestao,
  /** o que a pessoa não precisou mexer */
  rate: rate(c.acertou, c.errou, c.semSugestao),
  /** quando o sistema sugeriu, quanto acertou */
  precision: rate(c.acertou, c.errou, 0),
})

export async function getAccuracy(opts: { days?: number | null; companyId?: string | null }) {
  const since = opts.days ? new Date(Date.now() - opts.days * 86_400_000) : new Date(0)
  const company = opts.companyId ? sql`AND sc.company_id = ${opts.companyId}` : sql``

  const grouped = (
    await db.execute(sql`
      SELECT sc.company_id, c.name AS company_name, sc.field, sc.outcome, to_char(sc.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month, count(*)::int AS n
      FROM suggestion_checks sc JOIN companies c ON c.id = sc.company_id
      WHERE sc.created_at >= ${since} ${company}
      GROUP BY 1, 2, 3, 4, 5`)
  ).rows as { company_id: string; company_name: string; field: CheckField; outcome: string; month: string; n: number }[]

  const byField = new Map<CheckField, Counts>(FIELDS.map((f) => [f, empty()]))
  const critical = empty()
  const companies = new Map<string, { name: string; critical: Counts; fields: Map<CheckField, Counts> }>()
  const months = new Map<string, Counts>()
  for (const r of grouped) {
    add(byField.get(r.field) ?? byField.set(r.field, empty()).get(r.field)!, r.outcome, r.n)
    let co = companies.get(r.company_id)
    if (!co) companies.set(r.company_id, (co = { name: r.company_name, critical: empty(), fields: new Map() }))
    const cf = co.fields.get(r.field) ?? co.fields.set(r.field, empty()).get(r.field)!
    add(cf, r.outcome, r.n)
    if (CRITICAL_FIELDS.includes(r.field)) {
      add(critical, r.outcome, r.n)
      add(co.critical, r.outcome, r.n)
      add(months.get(r.month) ?? months.set(r.month, empty()).get(r.month)!, r.outcome, r.n)
    }
  }

  const [{ measured, before }] = (
    await db.execute(sql`
      SELECT
        (SELECT count(DISTINCT sc.document_id)::int FROM suggestion_checks sc WHERE sc.created_at >= ${since} ${company}) AS measured,
        (SELECT count(*)::int FROM fiscal_documents d WHERE d.status = 'APROVADO' AND d.suggestion IS NULL AND d.approved_at >= ${since}
           ${opts.companyId ? sql`AND d.company_id = ${opts.companyId}` : sql``}) AS before`)
  ).rows as { measured: number; before: number }[]

  // onde errou: últimos casos, com o motivo da sugestão, para corrigir a regra
  const misses = (
    await db.execute(sql`
      SELECT sc.id, sc.field, sc.outcome, sc.suggested, sc.final, sc.created_at, sc.document_id,
        d.type, d.number, d.suggestion, s.name AS supplier_name, c.name AS company_name,
        (SELECT p.code || ' · ' || p.name FROM projects p WHERE sc.field = 'obra' AND p.id::text = sc.suggested) AS suggested_project,
        (SELECT string_agg(p.code || ' · ' || p.name, ', ') FROM projects p WHERE sc.field = 'obra' AND p.id::text = ANY(string_to_array(sc.final, ','))) AS final_project,
        (SELECT 'PC-' || lpad(o.number::text, 4, '0') FROM purchase_orders o WHERE sc.field = 'pedido' AND o.id::text = sc.suggested) AS suggested_order,
        (SELECT 'PC-' || lpad(o.number::text, 4, '0') FROM purchase_orders o WHERE sc.field = 'pedido' AND o.id::text = sc.final) AS final_order
      FROM suggestion_checks sc
      JOIN fiscal_documents d ON d.id = sc.document_id
      JOIN companies c ON c.id = sc.company_id
      LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE sc.created_at >= ${since} ${company} AND sc.outcome <> 'ACERTOU'
      ORDER BY sc.created_at DESC
      LIMIT 30`)
  ).rows as any[]

  return {
    target: ACCURACY_TARGET,
    criticalFields: CRITICAL_FIELDS,
    documentsMeasured: measured,
    /** notas aprovadas no período que entraram antes da medição existir */
    documentsBeforeMeasurement: before,
    critical: summary(critical),
    fields: FIELDS.map((f) => ({ field: f, critical: CRITICAL_FIELDS.includes(f), ...summary(byField.get(f)!) })).filter((f) => f.total > 0),
    companies: [...companies.entries()]
      .map(([id, c]) => ({
        companyId: id,
        name: c.name,
        ...summary(c.critical),
        fields: Object.fromEntries([...c.fields.entries()].map(([f, v]) => [f, summary(v).rate])),
      }))
      .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101)),
    trend: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, c]) => ({ month, ...summary(c) })),
    misses: misses.map((m) => ({
      id: m.id,
      documentId: m.document_id,
      company: m.company_name,
      document: `${m.type === 'NFSE' ? 'NFS-e' : m.type === 'NFE' ? 'NF-e' : 'Doc.'} ${m.number ?? ''}`.trim(),
      supplier: m.supplier_name,
      field: m.field as CheckField,
      outcome: m.outcome,
      suggested: m.field === 'obra' ? (m.suggested_project ?? m.suggested) : m.field === 'pedido' ? (m.suggested_order ?? m.suggested) : m.suggested,
      final: m.field === 'obra' ? (m.final_project ?? m.final) : m.field === 'pedido' ? (m.final_order ?? m.final) : m.final,
      reason: m.field === 'obra' ? (m.suggestion?.projectReason ?? null) : m.field === 'categoria' ? (m.suggestion?.categoryReason ?? null) : null,
      at: m.created_at,
    })),
  }
}
