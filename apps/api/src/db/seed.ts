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
import { eq } from 'drizzle-orm'
import { buildNfeXml } from '../dev/nfe-builder.js'
import { cnpjWithDigits } from '../domain/cnpj.js'
import { approveDocument, ingestNfeXml, listPayables, registerPayment } from '../services/documents.js'
import { db, pool } from './client.js'
import { companies, documents, projectBudgets, projects, suppliers, users, type CostCategory } from './schema.js'

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
  const [admin] = await db
    .insert(users)
    .values([
      { companyId: company.id, name: 'Juliana Souza', email: 'admin@alpha.com.br', passwordHash, role: 'ADMIN' },
      { companyId: company.id, name: 'Rafael Lima', email: 'financeiro@alpha.com.br', passwordHash, role: 'FINANCEIRO' },
      { companyId: company.id, name: 'João Pereira', email: 'obra@alpha.com.br', passwordHash, role: 'GESTOR_OBRA' },
    ])
    .returning()

  for (const s of Object.values(SUPPLIERS)) {
    await db.insert(suppliers).values({
      companyId: company.id,
      cnpj: s.cnpj,
      name: s.name,
      tradeName: s.trade,
      defaultCategory: s.cat,
      status: 'HOMOLOGADO',
      email: `financeiro@${s.trade.toLowerCase().replace(/[^a-z]/g, '')}.com.br`,
    })
  }

  const createdProjects = []
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
