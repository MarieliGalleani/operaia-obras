/**
 * Prévia da medição para o proprietário (obra por administração).
 *
 * Período: do dia seguinte ao fechamento anterior até o dia de fechamento (padrão: mês cheio,
 * fechando no último dia). Cada obra pode ter o seu dia; sem dia na obra, vale o da construtora.
 *
 *   realizado  = custo das notas aprovadas da obra com emissão no período (material, mão de obra…)
 *   previsto   = notas que já chegaram e aguardam conferência + saldo dos pedidos de compra
 *                aprovados com entrega até o fechamento ("o que vem por aí")
 *   taxa       = % de administração sobre o custo (material e mão de obra)
 *   total      = realizado + previsto + taxa sobre os dois
 *
 * Quem paga: se o proprietário paga as compras direto aos fornecedores, à construtora vai só a taxa.
 * Empreitada (preço fechado) não tem taxa: a prévia mostra só o custo do período.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { companies, projects } from '../db/schema.js'
import { notFound } from './errors.js'

export const COST_GROUPS = [
  { key: 'mao_de_obra', label: 'Mão de obra', categories: ['MAO_DE_OBRA', 'TERCEIRIZADOS'] },
  { key: 'materiais', label: 'Materiais', categories: ['MATERIAIS'] },
  { key: 'equipamentos', label: 'Equipamentos', categories: ['EQUIPAMENTOS'] },
  { key: 'servicos', label: 'Serviços', categories: ['SERVICOS'] },
  { key: 'outros', label: 'Outros', categories: ['OUTROS'] },
] as const
const groupOf = (category: string) => COST_GROUPS.find((g) => (g.categories as readonly string[]).includes(category))?.key ?? 'outros'

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m = 1..12
const shift = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}
const brt = (ymd: string) => new Date(`${ymd}T00:00:00-03:00`)
const todayYmd = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/**
 * Período da medição do mês `ym` (AAAA-MM).
 * day = null → 1º ao último dia do mês. day = d → (d+1) do mês anterior até d do mês.
 */
export function measurementPeriod(ym: string, day: number | null) {
  const [y, m] = ym.split('-').map(Number)
  if (!day) {
    const first = `${ym}-01`
    const last = `${ym}-${pad(lastDay(y, m))}`
    return { month: ym, first, last, start: brt(first), end: brt(`${shift(ym, 1)}-01`) }
  }
  const prev = shift(ym, -1)
  const [py, pm] = prev.split('-').map(Number)
  const d = Math.min(day, 28)
  const startDay = d + 1 > lastDay(py, pm) ? null : d + 1
  const first = startDay ? `${prev}-${pad(startDay)}` : `${ym}-01`
  const last = `${ym}-${pad(d)}`
  return { month: ym, first, last, start: brt(first), end: new Date(brt(last).getTime() + 86_400_000) }
}

/** Medição em andamento hoje: depois do dia de fechamento, já é a do mês seguinte. */
export function currentMeasurementMonth(day: number | null, today = todayYmd()) {
  const ym = today.slice(0, 7)
  return day && Number(today.slice(8, 10)) > day ? shift(ym, 1) : ym
}

export async function projectContract(companyId: string, projectId: string) {
  const [row] = await db
    .select({ p: projects, defFee: companies.defaultAdminFeeBps, defDay: companies.defaultMeasurementDay })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
  if (!row) throw notFound('Obra')
  const admin = row.p.contractType === 'ADMINISTRACAO'
  return {
    project: row.p,
    contract: {
      type: row.p.contractType,
      adminFeeBps: admin ? (row.p.adminFeeBps ?? row.defFee) : 0,
      adminFeeFromDefault: admin && row.p.adminFeeBps == null,
      measurementDay: row.p.measurementDay ?? row.defDay ?? null,
      measurementDayFromDefault: row.p.measurementDay == null,
      ownerPaysSuppliers: row.p.ownerPaysSuppliers,
      ownerName: row.p.ownerName,
      ownerEmail: row.p.ownerEmail,
    },
  }
}

export async function getMeasurement(companyId: string, projectId: string, month?: string) {
  const { project, contract } = await projectContract(companyId, projectId)
  const ym = month ?? currentMeasurementMonth(contract.measurementDay)
  const period = measurementPeriod(ym, contract.measurementDay)
  const fee = (cents: number) => Math.round((cents * contract.adminFeeBps) / 10_000)

  // realizado: notas aprovadas com emissão no período (parte desta obra)
  const realizedRows = (
    await db.execute(sql`
      SELECT d.id, d.type, d.number, d.issue_date, d.total_amount, d.file_name, s.name AS supplier, a.category, sum(a.amount)::bigint AS amount,
        (SELECT coalesce(sum(p.amount), 0) FROM payables p WHERE p.document_id = d.id AND p.status <> 'CANCELADO')::bigint AS payable_total,
        (SELECT coalesce(sum(p.paid_amount), 0) FROM payables p WHERE p.document_id = d.id AND p.status <> 'CANCELADO')::bigint AS paid_total
      FROM allocations a
      JOIN fiscal_documents d ON d.id = a.document_id
      LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE a.project_id = ${projectId} AND d.company_id = ${companyId} AND d.status = 'APROVADO'
        AND d.issue_date >= ${period.start} AND d.issue_date < ${period.end}
      GROUP BY d.id, s.name, a.category
      ORDER BY d.issue_date, d.number`)
  ).rows as any[]

  const groups = new Map<string, number>(COST_GROUPS.map((g) => [g.key, 0]))
  const docs = new Map<string, any>()
  for (const r of realizedRows) {
    const amount = Number(r.amount)
    groups.set(groupOf(r.category), (groups.get(groupOf(r.category)) ?? 0) + amount)
    const cur = docs.get(r.id)
    const payableTotal = Number(r.payable_total)
    const paid = Number(r.paid_total)
    if (cur) {
      cur.amount += amount
      cur.categories.push(r.category)
    } else {
      docs.set(r.id, {
        id: r.id,
        type: r.type,
        number: r.number,
        issueDate: r.issue_date,
        supplier: r.supplier,
        categories: [r.category],
        amount,
        documentTotal: Number(r.total_amount ?? 0),
        payment: payableTotal === 0 ? 'SEM_TITULO' : paid >= payableTotal ? 'PAGO' : paid > 0 ? 'PARCIAL' : 'ABERTO',
        hasFile: !!r.file_name,
      })
    }
  }
  const realized = [...groups.values()].reduce((a, b) => a + b, 0)

  // previsto: notas aguardando conferência sugeridas para esta obra
  const pendingDocs = (
    await db.execute(sql`
      SELECT d.id, d.type, d.number, d.issue_date, d.total_amount, d.category, s.name AS supplier
      FROM fiscal_documents d LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.company_id = ${companyId} AND d.suggested_project_id = ${projectId}
        AND d.status IN ('RECEBIDO', 'EM_REVISAO') AND (d.issue_date IS NULL OR d.issue_date < ${period.end})
      ORDER BY d.issue_date`)
  ).rows.map((r: any) => ({
    id: r.id,
    kind: 'NOTA' as const,
    label: `${r.type === 'NFSE' ? 'NFS-e' : r.type === 'NFE' ? 'NF-e' : 'Documento'} ${r.number ?? ''}`.trim(),
    supplier: r.supplier,
    date: r.issue_date,
    category: r.category,
    amount: Number(r.total_amount ?? 0),
  }))

  // previsto: saldo dos pedidos aprovados com entrega até o fechamento
  const openOrders = (
    await db.execute(sql`
      SELECT o.id, o.number, o.expected_date, o.total, o.category, s.name AS supplier,
        (SELECT coalesce(sum(d.total_amount), 0) FROM fiscal_documents d WHERE d.purchase_order_id = o.id AND d.status IN ('APROVADO', 'RECEBIDO', 'EM_REVISAO'))::bigint AS invoiced
      FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
      WHERE o.company_id = ${companyId} AND o.project_id = ${projectId} AND o.status IN ('APROVADO', 'PARCIAL')
        AND (o.expected_date IS NULL OR o.expected_date < ${period.end})
      ORDER BY o.expected_date NULLS LAST`)
  ).rows
    .map((r: any) => ({
      id: r.id,
      kind: 'PEDIDO' as const,
      label: `Pedido PC-${String(r.number).padStart(4, '0')}`,
      supplier: r.supplier,
      date: r.expected_date,
      category: r.category,
      amount: Math.max(0, Number(r.total) - Number(r.invoiced)),
    }))
    .filter((o) => o.amount > 0)

  const forecastItems = [...pendingDocs, ...openOrders]
  const forecast = forecastItems.reduce((a, i) => a + i.amount, 0)

  // vencimentos do período (parte desta obra, proporcional ao rateio)
  const due = (
    await db.execute(sql`
      SELECT p.id, p.due_date, p.amount, p.paid_amount, p.status, d.type, d.number, s.name AS supplier,
        (SELECT coalesce(sum(a.amount), 0) FROM allocations a WHERE a.document_id = d.id AND a.project_id = ${projectId})::bigint AS share,
        d.total_amount
      FROM payables p JOIN fiscal_documents d ON d.id = p.document_id LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.company_id = ${companyId} AND p.status IN ('ABERTO', 'PARCIAL')
        AND p.due_date >= ${period.start} AND p.due_date < ${period.end}
        AND EXISTS (SELECT 1 FROM allocations a WHERE a.document_id = d.id AND a.project_id = ${projectId})
      ORDER BY p.due_date`)
  ).rows.map((r: any) => {
    const ratio = Number(r.total_amount) ? Number(r.share) / Number(r.total_amount) : 1
    return {
      id: r.id,
      dueDate: r.due_date,
      supplier: r.supplier,
      document: `${r.type === 'NFSE' ? 'NFS-e' : r.type === 'NFE' ? 'NF-e' : 'Doc.'} ${r.number ?? ''}`.trim(),
      amount: Math.round((Number(r.amount) - Number(r.paid_amount)) * ratio),
      status: r.status,
    }
  })

  const feeRealized = fee(realized)
  const feeForecast = fee(forecast)
  const expectedCosts = realized + forecast
  const expectedTotal = expectedCosts + feeRealized + feeForecast
  return {
    project: { id: project.id, code: project.code, name: project.name, address: project.address, imageUrl: project.imageUrl },
    contract,
    period: { month: period.month, first: period.first, last: period.last, closed: todayYmd() > period.last },
    realized: {
      total: realized,
      groups: COST_GROUPS.map((g) => ({ key: g.key, label: g.label, amount: groups.get(g.key) ?? 0 })),
      documents: [...docs.values()],
    },
    forecast: { total: forecast, items: forecastItems },
    fee: { pct: contract.adminFeeBps / 100, onRealized: feeRealized, onForecast: feeForecast, total: feeRealized + feeForecast },
    totals: {
      realizedWithFee: realized + feeRealized,
      expectedCosts,
      expected: expectedTotal,
      // quem recebe o quê
      toSuppliers: contract.ownerPaysSuppliers ? expectedCosts : 0,
      toBuilder: contract.ownerPaysSuppliers ? feeRealized + feeForecast : expectedTotal,
    },
    due,
  }
}

/** Resumo de várias obras (lista do portal) */
export async function projectsSummary(companyId: string, projectIds: string[]) {
  if (!projectIds.length) return []
  const rows = await db.select().from(projects).where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds)))
  const out = []
  for (const p of rows) {
    const m = await getMeasurement(companyId, p.id)
    const [{ cost }] = (
      await db.execute(sql`SELECT coalesce(sum(a.amount), 0)::bigint AS cost FROM allocations a JOIN fiscal_documents d ON d.id = a.document_id
        WHERE a.project_id = ${p.id} AND d.status = 'APROVADO'`)
    ).rows as { cost: string }[]
    out.push({
      id: p.id,
      code: p.code,
      name: p.name,
      address: p.address,
      imageUrl: p.imageUrl,
      status: p.status,
      budgetTotal: p.budgetTotal,
      costToDate: Number(cost),
      contract: m.contract,
      measurement: { month: m.period.month, first: m.period.first, last: m.period.last, expected: m.totals.expected, realizedWithFee: m.totals.realizedWithFee },
    })
  }
  return out.sort((a, b) => a.code.localeCompare(b.code))
}

