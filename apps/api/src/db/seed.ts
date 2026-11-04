/**
 * Seed de demonstração — Construtora Alpha (dados 100% fictícios).
 *
 * Os dados NÃO são inseridos direto nas tabelas: as notas passam pelo mesmo fluxo
 * do produto (importação do XML → validação → aprovação → pagamento), então o seed
 * também funciona como um teste de ponta a ponta.
 *
 * Login: admin@alpha.com.br / operaia123
 */
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { buildNfeXml } from '../dev/nfe-builder.js'
import { cnpjWithDigits } from '../domain/cnpj.js'
import { approveDocument, ingestNfeXml, listPayables, registerPayment } from '../services/documents.js'
import { approveOrder, createOrder } from '../services/purchases.js'
import { DEFAULT_STAGES, createMaterialRequest, createOccurrence, declineMaterialRequest, receiveDelivery, resolveOccurrence, setStages, updateStageProgress } from '../services/field.js'
import { db, pool } from './client.js'
import { auditLogs, deliveryReceipts, materialRequests, occurrences, projectStages, stageUpdates, companies, documents, projectBudgets, projects, purchaseOrders, suppliers, users, type CostCategory } from './schema.js'

const COMPANY_CNPJ = cnpjWithDigits('451230980001')

const SUPPLIERS = {
  concremax: { cnpj: cnpjWithDigits('123456780001'), name: 'Concremax Concreto Ltda', trade: 'Concremax', cat: 'MATERIAIS' as CostCategory },
  supermix: { cnpj: cnpjWithDigits('223344550001'), name: 'Supermix Concretos S.A.', trade: 'Supermix', cat: 'MATERIAIS' as CostCategory },
  acoforte: { cnpj: cnpjWithDigits('334455660001'), name: 'Aço Forte Comércio de Ferro Ltda', trade: 'Aço Forte', cat: 'MATERIAIS' as CostCategory },
  construluz: { cnpj: cnpjWithDigits('445566770001'), name: 'Construluz Materiais Elétricos Ltda', trade: 'Construluz', cat: 'MATERIAIS' as CostCategory },
  deposito: { cnpj: cnpjWithDigits('556677880001'), name: 'Depósito São Carlos Materiais de Construção', trade: 'Depósito SC', cat: 'MATERIAIS' as CostCategory },
  rr: { cnpj: cnpjWithDigits('667788990001'), name: 'RR Terraplenagem e Locação Ltda', trade: 'RR Terraplenagem', cat: 'EQUIPAMENTOS' as CostCategory },
  montafacil: { cnpj: cnpjWithDigits('778899000001'), name: 'MontaFácil Instalações Ltda', trade: 'MontaFácil', cat: 'TERCEIRIZADOS' as CostCategory },
  topo: { cnpj: cnpjWithDigits('889900110001'), name: 'Topo Engenharia e Serviços', trade: 'Topo Engenharia', cat: 'SERVICOS' as CostCategory },
  equipe: { cnpj: cnpjWithDigits('990011220001'), name: 'Equipe Forte Mão de Obra Ltda', trade: 'Equipe Forte', cat: 'MAO_DE_OBRA' as CostCategory },
}
type SupplierKey = keyof typeof SUPPLIERS

const CATALOG: Record<SupplierKey, { description: string; ncm: string; unit: string; price: number }[]> = {
  concremax: [{ description: 'CONCRETO USINADO FCK 30 MPA', ncm: '38245000', unit: 'M3', price: 420 }],
  supermix: [{ description: 'CONCRETO USINADO FCK 30 MPA', ncm: '38245000', unit: 'M3', price: 372 }],
  acoforte: [
    { description: 'VERGALHAO ACO CA-50 10MM', ncm: '72142000', unit: 'KG', price: 6.4 },
    { description: 'VERGALHAO ACO CA-60 5MM', ncm: '72171090', unit: 'KG', price: 7.1 },
  ],
  construluz: [
    { description: 'CABO FLEXIVEL 2,5MM 750V', ncm: '85444900', unit: 'M', price: 3.2 },
    { description: 'QUADRO DE DISTRIBUICAO 24 DISJ', ncm: '85372090', unit: 'UN', price: 410 },
  ],
  deposito: [
    { description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', price: 38.9 },
    { description: 'AREIA MEDIA LAVADA', ncm: '25059000', unit: 'M3', price: 145 },
    { description: 'BLOCO CERAMICO 14X19X29', ncm: '69041000', unit: 'MIL', price: 1250 },
  ],
  rr: [{ description: 'LOCACAO DE RETROESCAVADEIRA COM OPERADOR', ncm: '00000000', unit: 'H', price: 450 }],
  montafacil: [{ description: 'SERVICO DE INSTALACAO HIDRAULICA - EMPREITADA', ncm: '00000000', unit: 'UN', price: 1 }],
  topo: [{ description: 'SERVICO DE TOPOGRAFIA E ACOMPANHAMENTO TECNICO', ncm: '00000000', unit: 'UN', price: 1 }],
  equipe: [{ description: 'MAO DE OBRA DE PEDREIROS E SERVENTES - MEDICAO', ncm: '00000000', unit: 'UN', price: 1 }],
}

const PROJECTS = [
  { code: 'OBR-001', name: 'Residencial Aurora', address: 'Rua das Acácias, 450 — São Carlos/SP', budget: 1_200_000, spend: 935_000 },
  { code: 'OBR-002', name: 'Edifício Horizonte', address: 'Av. São Carlos, 2100 — São Carlos/SP', budget: 850_000, spend: 712_000 },
  { code: 'OBR-003', name: 'Casa Jardim', address: 'Rua Jardim Botânico, 88 — Ibaté/SP', budget: 480_000, spend: 452_000 },
  { code: 'OBR-004', name: 'Galpão Logístico Ibaté', address: 'Rod. SP-215, km 4 — Ibaté/SP', budget: 2_300_000, spend: 310_000 },
]

/** Participação de cada categoria no custo e fornecedores que a atendem */
const MIX: Array<{ cat: CostCategory; share: number; suppliers: SupplierKey[] }> = [
  { cat: 'MATERIAIS', share: 0.41, suppliers: ['concremax', 'acoforte', 'deposito', 'construluz', 'supermix'] },
  { cat: 'MAO_DE_OBRA', share: 0.24, suppliers: ['equipe'] },
  { cat: 'TERCEIRIZADOS', share: 0.18, suppliers: ['montafacil'] },
  { cat: 'EQUIPAMENTOS', share: 0.1, suppliers: ['rr'] },
  { cat: 'SERVICOS', share: 0.07, suppliers: ['topo'] },
]
const BUDGET_SHARE: Record<CostCategory, number> = { MATERIAIS: 0.4, MAO_DE_OBRA: 0.24, TERCEIRIZADOS: 0.17, EQUIPAMENTOS: 0.1, SERVICOS: 0.06, OUTROS: 0.03 }

// gerador determinístico, para o seed sair igual toda vez
let seedState = 42
const rand = () => ((seedState = (seedState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

const today = new Date()
const dayISO = (daysAgo: number) => {
  const d = new Date(today.getTime() - daysAgo * 86400000)
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}
const plusDays = (ymd: string, days: number) => new Date(new Date(`${ymd}T12:00:00-03:00`).getTime() + days * 86400000).toISOString().slice(0, 10)

let nfNumber = 10200
async function importAndApprove(opts: {
  companyId: string
  userId: string
  supplier: SupplierKey
  projectId: string
  projectName: string
  category: CostCategory
  amount: number
  daysAgo: number
  priceFactor?: number
  installmentsCount?: number
}) {
  const s = SUPPLIERS[opts.supplier]
  const products = CATALOG[opts.supplier]
  const issueYmd = dayISO(opts.daysAgo)
  // distribui o valor entre os produtos do catálogo
  const weights = products.map(() => 0.5 + rand())
  const wsum = weights.reduce((a, b) => a + b, 0)
  const items = products.map((p, i) => {
    const target = (opts.amount * weights[i]) / wsum
    const unitPrice = Math.round(p.price * (opts.priceFactor ?? 0.98 + rand() * 0.04) * 100) / 100
    const quantity = p.price === 1 ? 1 : Math.max(1, Math.round(target / unitPrice))
    return { description: p.description, ncm: p.ncm, unit: p.unit, quantity, unitPrice: p.price === 1 ? Math.round(target * 100) / 100 : unitPrice }
  })
  const total = items.reduce((a, it) => a + Math.round(it.quantity * it.unitPrice * 100) / 100, 0)
  const n = opts.installmentsCount ?? (total > 40000 ? 2 : 1)
  const instAmounts = Array.from({ length: n }, (_, i) => (i < n - 1 ? Math.floor((total / n) * 100) / 100 : 0))
  instAmounts[n - 1] = Math.round((total - instAmounts.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100

  const { xml } = buildNfeXml({
    number: nfNumber++,
    issueDate: `${issueYmd}T09:30:00-03:00`,
    issuer: { cnpj: s.cnpj, name: s.name, tradeName: s.trade },
    recipientCnpj: COMPANY_CNPJ,
    recipientName: 'Construtora Alpha Ltda',
    operation: opts.category === 'MATERIAIS' ? 'Venda de mercadoria' : 'Prestação de serviço',
    items,
    installments: instAmounts.map((a, i) => ({ dueDate: plusDays(issueYmd, 28 * (i + 1)), amount: a })),
    extraInfo: `Obra: ${opts.projectName}. Entrega no canteiro.`,
  })

  const res = await ingestNfeXml({ companyId: opts.companyId, userId: opts.userId, fileName: `NFe-${s.trade}-${nfNumber - 1}.xml`, content: Buffer.from(xml), source: rand() > 0.5 ? 'EMAIL' : 'UPLOAD' })
  const doc = res.document
  await approveDocument(opts.companyId, opts.userId, doc.id, {
    allocations: [{ projectId: opts.projectId, category: opts.category, amount: doc.totalAmount! }],
    acknowledgeCritical: true,
  })
  return doc
}

async function main() {
  const existing = await db.select().from(companies).where(eq(companies.cnpj, COMPANY_CNPJ))
  if (existing.length) {
    console.log('Seed já aplicado (Construtora Alpha existe). Use pnpm db:reset para recriar.')
    return
  }

  const [company] = await db
    .insert(companies)
    .values({ name: 'Construtora Alpha', cnpj: COMPANY_CNPJ, apiKey: `oo_${randomBytes(18).toString('hex')}` })
    .returning()
  const passwordHash = await bcrypt.hash('operaia123', 10)
  const users_ = await db
    .insert(users)
    .values([
      { companyId: company.id, name: 'Juliana Souza', email: 'admin@alpha.com.br', passwordHash, role: 'ADMIN' },
      { companyId: company.id, name: 'Rafael Lima', email: 'financeiro@alpha.com.br', passwordHash, role: 'FINANCEIRO' },
      { companyId: company.id, name: 'João Pereira', email: 'obra@alpha.com.br', passwordHash, role: 'GESTOR_OBRA' },
      { companyId: company.id, name: 'Zé Carlos', email: 'mestre@alpha.com.br', passwordHash, role: 'MESTRE' },
    ])
    .returning()
  const admin = users_[0]

  for (const s of Object.values(SUPPLIERS)) {
    await db.insert(suppliers).values({
      companyId: company.id,
      cnpj: s.cnpj,
      name: s.name,
      tradeName: s.trade,
      defaultCategory: s.cat,
      // Supermix ainda não foi homologada: mostra o fluxo de homologar na demonstração
      status: s === SUPPLIERS.supermix ? 'PENDENTE' : 'HOMOLOGADO',
      homologatedAt: s === SUPPLIERS.supermix ? null : new Date(Date.now() - 90 * 86400000),
      homologatedBy: s === SUPPLIERS.supermix ? null : 'Rafael Lima',
      email: `financeiro@${s.trade.toLowerCase().replace(/[^a-z]/g, '')}.com.br`,
    })
  }

  const createdProjects: Array<(typeof PROJECTS)[number] & { id: string }> = []
  for (const p of PROJECTS) {
    const [row] = await db
      .insert(projects)
      .values({
        companyId: company.id,
        code: p.code,
        name: p.name,
        address: p.address,
        budgetTotal: p.budget * 100,
        startDate: new Date(`${dayISO(160)}T12:00:00-03:00`),
      })
      .returning()
    await db.insert(projectBudgets).values(
      Object.entries(BUDGET_SHARE).map(([cat, share]) => ({ projectId: row.id, category: cat as CostCategory, amount: Math.round(p.budget * share) * 100 })),
    )
    createdProjects.push({ ...p, id: row.id })
  }

  // ~5 meses de histórico; o mês atual concentra menos (obras em andamento)
  const months = [
    { daysAgo: [140, 128], weight: 0.18 },
    { daysAgo: [110, 98], weight: 0.21 },
    { daysAgo: [80, 68], weight: 0.21 },
    { daysAgo: [50, 38], weight: 0.21 },
    { daysAgo: [18, 4], weight: 0.19 },
  ]

  console.log('Importando notas pelo fluxo real…')
  let count = 0
  for (const p of createdProjects) {
    for (const m of months) {
      for (const mix of MIX) {
        const slice = p.spend * m.weight * mix.share
        // materiais: 2 fornecedores por mês, alternando
        const sups = mix.cat === 'MATERIAIS' ? [mix.suppliers[count % 4], mix.suppliers[(count + 1) % 4]] : mix.suppliers
        for (const [i, sup] of sups.entries()) {
          await importAndApprove({
            companyId: company.id,
            userId: admin.id,
            supplier: sup,
            projectId: p.id,
            projectName: p.name,
            category: mix.cat,
            amount: slice / sups.length,
            daysAgo: m.daysAgo[i % 2] + Math.floor(rand() * 5),
          })
          count++
        }
      }
    }
  }
  // compra barata de concreto em outro fornecedor, para gerar oportunidade de economia
  await importAndApprove({ companyId: company.id, userId: admin.id, supplier: 'supermix', projectId: createdProjects[3].id, projectName: createdProjects[3].name, category: 'MATERIAIS', amount: 18_600, daysAgo: 60 })
  // aço com preço acima da média (alerta de variação de preço)
  await importAndApprove({ companyId: company.id, userId: admin.id, supplier: 'acoforte', projectId: createdProjects[0].id, projectName: createdProjects[0].name, category: 'MATERIAIS', amount: 22_400, daysAgo: 2, priceFactor: 1.18 })
  // concreto da Concremax de novo — dispara a oportunidade (Supermix mais barata)
  await importAndApprove({ companyId: company.id, userId: admin.id, supplier: 'concremax', projectId: createdProjects[0].id, projectName: createdProjects[0].name, category: 'MATERIAIS', amount: 12_500, daysAgo: 1 })
  console.log(`✔ ${count + 3} notas importadas e aprovadas`)

  // pagamentos: títulos vencidos foram pagos (um parcialmente, para mostrar o estado)
  const open = await listPayables(company.id, { status: 'ABERTO' })
  let paid = 0
  for (const [i, t] of open.entries()) {
    if (t.dueDate < new Date(today.getTime() - 86400000)) {
      const partial = i === 3
      await registerPayment(company.id, admin.id, t.id, {
        amount: partial ? Math.round(t.amount / 2) : t.amount,
        paidAt: t.dueDate.toISOString().slice(0, 10),
        method: 'PIX',
      })
      paid++
    }
  }
  console.log(`✔ ${paid} títulos pagos`)

  // ---------------------------------------------------------------- compras
  // pedidos feitos antes das notas: atendido no prazo, atendido com atraso, parcial,
  // atrasado sem entrega, nota com preço acima do pedido, rascunho e aguardando
  const supplierRows = await db.select().from(suppliers).where(eq(suppliers.companyId, company.id))
  const supId = (k: SupplierKey) => supplierRows.find((r) => r.cnpj === SUPPLIERS[k].cnpj)!.id
  const item = (k: SupplierKey, i: number, quantity: number, factor = 1) => {
    const c = CATALOG[k][i]
    return { description: c.description, ncm: c.ncm, unit: c.unit, quantity, unitPrice: Math.round(c.price * factor * 100) / 100 }
  }
  const buyer = { id: users_[2].id, name: users_[2].name }
  const approver = { id: admin.id, name: admin.name }
  async function order(o: { sup: SupplierKey; project: number; items: ReturnType<typeof item>[]; orderedDaysAgo: number; expectedInDays: number; approve?: boolean; terms?: string; requestId?: string }) {
    const po = await createOrder(company.id, buyer, {
      projectId: createdProjects[o.project].id,
      supplierId: supId(o.sup),
      category: SUPPLIERS[o.sup].cat,
      expectedDate: plusDays(dayISO(o.orderedDaysAgo), o.expectedInDays),
      paymentTerms: o.terms ?? '28 dias',
      items: o.items.map(({ ncm, ...i }) => i),
      requestId: o.requestId,
    })
    if (o.approve !== false) await approveOrder(company.id, approver, po.id)
    const at = new Date(`${dayISO(o.orderedDaysAgo)}T10:00:00-03:00`)
    await db.update(purchaseOrders).set({ createdAt: at, updatedAt: at, ...(o.approve !== false && { approvedAt: new Date(at.getTime() + 3 * 3600000) }) }).where(eq(purchaseOrders.id, po.id))
    await db.update(auditLogs).set({ createdAt: at }).where(and(eq(auditLogs.entityId, po.id), eq(auditLogs.action, 'created')))
    await db.update(auditLogs).set({ createdAt: new Date(at.getTime() + 3 * 3600000) }).where(and(eq(auditLogs.entityId, po.id), eq(auditLogs.action, 'approved')))
    return po
  }
  async function deliver(po: { code: string; projectId: string }, sup: SupplierKey, items: ReturnType<typeof item>[], daysAgo: number, approve = true) {
    const s = SUPPLIERS[sup]
    const issueYmd = dayISO(daysAgo)
    const total = items.reduce((a, it) => a + Math.round(it.quantity * it.unitPrice * 100) / 100, 0)
    const { xml } = buildNfeXml({
      number: nfNumber++,
      issueDate: `${issueYmd}T11:00:00-03:00`,
      issuer: { cnpj: s.cnpj, name: s.name, tradeName: s.trade },
      recipientCnpj: COMPANY_CNPJ,
      items,
      purchaseOrder: po.code,
      installments: [{ dueDate: plusDays(issueYmd, 28), amount: Math.round(total * 100) / 100 }],
      extraInfo: `Pedido ${po.code}. Entrega no canteiro.`,
    })
    const res = await ingestNfeXml({ companyId: company.id, userId: admin.id, fileName: `NFe-${s.trade}-${nfNumber - 1}.xml`, content: Buffer.from(xml), source: 'EMAIL' })
    if (approve) await approveDocument(company.id, admin.id, res.documentId, { allocations: [{ projectId: po.projectId, category: SUPPLIERS[sup].cat, amount: res.document.totalAmount! }], acknowledgeCritical: true })
  }
  // ---------------------------------------------------------------- app de obra
  const mestre = { id: users_[3].id, name: users_[3].name }
  const at = (daysAgo: number, hour = 9) => new Date(`${dayISO(daysAgo)}T${String(hour).padStart(2, '0')}:00:00-03:00`)
  async function receive(po: { id: string }, qty: number[], daysAgo: number, problem?: string) {
    const full = await db.query.purchaseOrderItems.findMany({ where: (t, { eq: e }) => e(t.orderId, po.id) })
    const r = await receiveDelivery(company.id, mestre, po.id, { items: full.map((it, i) => ({ orderItemId: it.id, quantity: qty[i] ?? 0 })), problem: !!problem, notes: problem })
    await db.update(deliveryReceipts).set({ receivedAt: at(daysAgo, 10) }).where(eq(deliveryReceipts.id, r.id))
    await db.update(auditLogs).set({ createdAt: at(daysAgo, 10) }).where(and(eq(auditLogs.entityId, po.id), eq(auditLogs.action, 'received_on_site')))
    if (r.occurrenceId) await db.update(occurrences).set({ createdAt: at(daysAgo, 10) }).where(eq(occurrences.id, r.occurrenceId))
  }
  // pedido de material do mestre que virou o PC-0006 (blocos para o Aurora)
  const reqBlocos = await createMaterialRequest(company.id, mestre, createdProjects[0].id, { items: [{ description: 'Bloco cerâmico 14x19x29', unit: 'MIL', quantity: 12 }], neededBy: plusDays(dayISO(3), 10), notes: 'Para a alvenaria do 3º pavimento' })
  await db.update(materialRequests).set({ createdAt: at(3, 7) }).where(eq(materialRequests.id, reqBlocos.id))
  {
    const a = [item('concremax', 0, 24)]
    const p1 = await order({ sup: 'concremax', project: 0, items: a, orderedDaysAgo: 41, expectedInDays: 6 })
    await deliver(p1, 'concremax', a, 35)
    await receive(p1, [24], 35)
    const b = [item('acoforte', 0, 2600), item('acoforte', 1, 700)]
    const p2 = await order({ sup: 'acoforte', project: 1, items: b, orderedDaysAgo: 30, expectedInDays: 8, terms: '2x 28/56 dias' })
    await deliver(p2, 'acoforte', b, 19)
    await receive(p2, [2600, 700], 19)
    const c = [item('deposito', 0, 400), item('deposito', 1, 60)]
    const p3 = await order({ sup: 'deposito', project: 3, items: c, orderedDaysAgo: 12, expectedInDays: 6 })
    await deliver(p3, 'deposito', [item('deposito', 0, 200)], 6)
    await receive(p3, [200, 0], 6)
    await order({ sup: 'construluz', project: 2, items: [item('construluz', 0, 1800), item('construluz', 1, 2)], orderedDaysAgo: 6, expectedInDays: 4 })
    const e = [item('acoforte', 0, 1500)]
    const p5 = await order({ sup: 'acoforte', project: 3, items: e, orderedDaysAgo: 3, expectedInDays: 5 })
    await deliver(p5, 'acoforte', [item('acoforte', 0, 1500, 1.09)], 0, false)
    await receive(p5, [1440], 0, '60 kg a menos que o pedido; 4 barras chegaram tortas')
    await order({ sup: 'deposito', project: 0, items: [item('deposito', 2, 12)], orderedDaysAgo: 2, expectedInDays: 9, requestId: reqBlocos.id })
    await order({ sup: 'supermix', project: 3, items: [item('supermix', 0, 45)], orderedDaysAgo: 0, expectedInDays: 10, approve: false })
  }
  console.log('✔ 7 pedidos de compra (atendidos, parcial, atrasado, divergente, rascunho)')

  // etapas e avanço físico de cada obra (Casa Jardim com físico atrás do financeiro)
  const PROGRESS: number[][] = [
    [100, 100, 100, 85, 60, 55, 25, 0], // Aurora
    [100, 100, 100, 70, 30, 40, 10, 0], // Horizonte
    [100, 100, 100, 90, 70, 45, 15, 0], // Casa Jardim
    [100, 60, 10, 0, 0, 0, 0, 0], // Galpão
  ]
  for (const [pi, p] of createdProjects.entries()) {
    const view = await setStages(company.id, admin.id, p.id, DEFAULT_STAGES)
    for (const [si, st] of view.stages.entries()) {
      const target = PROGRESS[pi][si]
      if (!target) continue
      // duas medições por etapa em andamento: metade há ~3 semanas, o resto há poucos dias
      const steps = target === 100 ? [target] : [Math.round(target / 2), target]
      for (const [k, v] of steps.entries()) {
        const u = await updateStageProgress(company.id, mestre, st.id, { progress: v, note: v === 100 ? 'Etapa concluída' : null })
        const daysAgo = target === 100 ? 70 - si * 8 : k === 0 ? 20 : 2 + si
        await db.update(stageUpdates).set({ createdAt: at(daysAgo, 16) }).where(eq(stageUpdates.id, u.stageUpdateId))
        await db.update(projectStages).set({ updatedAt: at(daysAgo, 16) }).where(eq(projectStages.id, st.id))
      }
    }
  }
  // pedidos de material em aberto e um recusado
  const r1 = await createMaterialRequest(company.id, mestre, createdProjects[0].id, {
    items: [
      { description: 'Cimento CP II 50kg', unit: 'SC', quantity: 120 },
      { description: 'Areia média lavada', unit: 'M3', quantity: 18 },
    ],
    neededBy: dayISO(-2),
    urgent: true,
    notes: 'Reboco do 2º pavimento começa quinta',
  })
  await db.update(materialRequests).set({ createdAt: at(0, 7) }).where(eq(materialRequests.id, r1.id))
  const r2 = await createMaterialRequest(company.id, mestre, createdProjects[1].id, { items: [{ description: 'Cabo flexível 2,5mm 750V', unit: 'M', quantity: 900 }], neededBy: dayISO(-6) })
  await db.update(materialRequests).set({ createdAt: at(1, 8) }).where(eq(materialRequests.id, r2.id))
  const r3 = await createMaterialRequest(company.id, mestre, createdProjects[2].id, { items: [{ description: 'Andaime tubular (locação)', unit: 'UN', quantity: 20 }] })
  await declineMaterialRequest(company.id, { id: admin.id, name: admin.name }, r3.id, 'Já tem andaime da obra Aurora liberando na sexta; vamos remanejar.')
  await db.update(materialRequests).set({ createdAt: at(9, 8), handledAt: at(8, 11) }).where(eq(materialRequests.id, r3.id))
  // ocorrências
  const o1 = await createOccurrence(company.id, mestre, createdProjects[2].id, {
    type: 'FALTA_MATERIAL',
    severity: 'ALTA',
    title: 'Equipe de elétrica parada sem cabo',
    description: 'O cabo do pedido PC-0004 não chegou. 3 eletricistas sem frente de serviço desde ontem.',
  })
  await db.update(occurrences).set({ createdAt: at(1, 8) }).where(eq(occurrences.id, o1.id))
  const o2 = await createOccurrence(company.id, mestre, createdProjects[3].id, { type: 'CLIMA', severity: 'BAIXA', title: 'Chuva forte: concretagem do bloco C adiada', description: 'Remarcada para segunda.' })
  await db.update(occurrences).set({ createdAt: at(4, 15) }).where(eq(occurrences.id, o2.id))
  const o3 = await createOccurrence(company.id, mestre, createdProjects[0].id, { type: 'SEGURANCA', severity: 'MEDIA', title: 'Guarda-corpo faltando na laje do 3º pavimento' })
  await resolveOccurrence(company.id, mestre, o3.id, 'Guarda-corpo instalado e equipe orientada.')
  await db.update(occurrences).set({ createdAt: at(12, 9), resolvedAt: at(11, 14) }).where(eq(occurrences.id, o3.id))
  console.log('✔ app de obra: etapas, recebimentos, 3 pedidos de material e 3 ocorrências')

  // notas que ficam na fila de revisão
  const pending: Array<{ sup: SupplierKey; extra?: string; number?: number; amount: number }> = [
    { sup: 'construluz', extra: 'Entrega conforme pedido 8812', amount: 8_900 }, // sem obra
    { sup: 'deposito', extra: undefined, amount: 4_350 }, // sem obra
  ]
  for (const pnd of pending) {
    const s = SUPPLIERS[pnd.sup]
    const prod = CATALOG[pnd.sup][0]
    const qty = Math.round(pnd.amount / prod.price)
    const { xml } = buildNfeXml({
      number: nfNumber++,
      issueDate: `${dayISO(1)}T14:00:00-03:00`,
      issuer: { cnpj: s.cnpj, name: s.name, tradeName: s.trade },
      recipientCnpj: COMPANY_CNPJ,
      items: [{ description: prod.description, ncm: prod.ncm, unit: prod.unit, quantity: qty, unitPrice: prod.price }],
      installments: [{ dueDate: plusDays(dayISO(1), 21), amount: Math.round(qty * prod.price * 100) / 100 }],
      extraInfo: pnd.extra,
    })
    await ingestNfeXml({ companyId: company.id, userId: admin.id, fileName: `NFe-${s.trade}-${nfNumber - 1}.xml`, content: Buffer.from(xml), source: 'EMAIL' })
  }
  // a mesma nota da Construluz reenviada com outra chave → possível duplicidade
  const [lastConstruluz] = await db
    .select()
    .from(documents)
    .where(eq(documents.number, String(nfNumber - 2)))
  {
    const s = SUPPLIERS.construluz
    const prod = CATALOG.construluz[0]
    const qty = Math.round(8_900 / prod.price)
    const { xml } = buildNfeXml({
      number: Number(lastConstruluz.number),
      cNF: 77777777,
      issueDate: `${dayISO(0)}T08:10:00-03:00`,
      issuer: { cnpj: s.cnpj, name: s.name, tradeName: s.trade },
      recipientCnpj: COMPANY_CNPJ,
      items: [{ description: prod.description, ncm: prod.ncm, unit: prod.unit, quantity: qty, unitPrice: prod.price }],
      installments: [{ dueDate: plusDays(dayISO(0), 21), amount: Math.round(qty * prod.price * 100) / 100 }],
      extraInfo: 'Obra: Edifício Horizonte',
    })
    await ingestNfeXml({ companyId: company.id, userId: admin.id, fileName: `NFe-Construluz-reenvio.xml`, content: Buffer.from(xml), source: 'EMAIL' })
  }
  console.log('✔ 3 notas na fila de revisão (2 sem obra, 1 possível duplicidade)')
  console.log(`\nLogin: admin@alpha.com.br / operaia123\nChave de integração: ${company.apiKey}`)
}

await main()
await pool.end()
