/**
 * Teste de ponta a ponta da API contra o PostgreSQL de desenvolvimento.
 * Cria duas construtoras próprias (não depende do seed) e apaga tudo no final.
 */
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { db, pool } from './db/client.js'
import { companies, documents, projectBudgets, projects, purchaseOrders, suggestionChecks, suppliers, users } from './db/schema.js'
import { hasMoto, startFakeS3 } from './dev/fake-s3.js'
import { currentMonth } from './services/margin.js'
import { STORAGE_DIR, diskStorage, s3Storage, setStorage, storage } from './services/storage.js'
import { cnpjWithDigits, formatCnpj } from './domain/cnpj.js'
import { buildNfeXml } from './dev/nfe-builder.js'
import { buildNfseXml } from './dev/nfse-builder.js'

const app = await buildApp()
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
const companyCnpj = cnpjWithDigits(rnd() + '0001')
const otherCnpj = cnpjWithDigits(rnd() + '0001')
const supplierCnpj = cnpjWithDigits(rnd() + '0001')
const createdCompanies: string[] = []
let token = ''
let otherToken = ''
let projectA = ''
let projectB = ''

function upload(xml: string, name = 'nota.xml', auth = token) {
  const boundary = '----operaia' + rnd()
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/xml\r\n\r\n`),
    Buffer.from(xml),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return app.inject({ method: 'POST', url: '/api/documents/upload', headers: { authorization: `Bearer ${auth}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
}

const api = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, auth = token) =>
  app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${auth}` } })

async function makeCompany(cnpj: string, email: string) {
  const [c] = await db.insert(companies).values({ name: `Teste ${cnpj}`, cnpj, apiKey: `test_${randomBytes(8).toString('hex')}` }).returning()
  createdCompanies.push(c.id)
  await db.insert(users).values({ companyId: c.id, name: 'Teste', email, passwordHash: await bcrypt.hash('senha123', 4), role: 'ADMIN' })
  // IP próprio por construtora de teste: o limite de tentativas de login é por IP
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha123' }, remoteAddress: `10.9.${createdCompanies.length}.1` })
  return { company: c, token: res.json().token as string }
}

beforeAll(async () => {
  const a = await makeCompany(companyCnpj, `t${rnd()}@teste.com`)
  token = a.token
  const b = await makeCompany(otherCnpj, `t${rnd()}@teste.com`)
  otherToken = b.token
  const [p1, p2] = await db
    .insert(projects)
    .values([
      { companyId: a.company.id, code: 'T-01', name: 'Residencial Teste', budgetTotal: 10_000_00 },
      { companyId: a.company.id, code: 'T-02', name: 'Galpão Beta', budgetTotal: 100_000_00 },
    ])
    .returning()
  projectA = p1.id
  projectB = p2.id
  await db.insert(projectBudgets).values({ projectId: p1.id, category: 'MATERIAIS', amount: 8_000_00 })
})

afterAll(async () => {
  if (createdCompanies.length) await db.delete(companies).where(inArray(companies.id, createdCompanies))
  await app.close()
  await pool.end()
})

const nfe = (n: number, opts: Partial<Parameters<typeof buildNfeXml>[0]> = {}) =>
  buildNfeXml({
    number: n,
    issueDate: new Date().toISOString().slice(0, 10) + 'T10:00:00-03:00',
    issuer: { cnpj: supplierCnpj, name: 'Fornecedor Teste Ltda' },
    recipientCnpj: companyCnpj,
    items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', quantity: 200, unitPrice: 40 }],
    installments: [
      { dueDate: '2030-01-10', amount: 4000 },
      { dueDate: '2030-02-10', amount: 4000 },
    ],
    extraInfo: 'Obra: Residencial Teste',
    ...opts,
  }).xml

describe('fluxo de documentos', () => {
  let docId = ''

  it('exige login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard' })
    expect(res.statusCode).toBe(401)
  })

  it('importa XML, cadastra fornecedor e identifica a obra', async () => {
    const res = await upload(nfe(1001))
    expect(res.statusCode).toBe(200)
    const r = res.json().results[0]
    expect(r.status).toBe('CRIADO')
    expect(r.document.totalAmount).toBe(8_000_00)
    expect(r.document.suggestedProjectId).toBe(projectA)
    expect(r.document.category).toBe('MATERIAIS')
    // fornecedor novo é só INFO → não bloqueia
    expect(r.document.status).toBe('RECEBIDO')
    expect(r.document.issues.map((i: any) => i.code)).toContain('FORNECEDOR_NOVO')
    docId = r.documentId
  })

  it('reenvio do mesmo XML não duplica', async () => {
    const r = (await upload(nfe(1001))).json().results[0]
    expect(r.status).toBe('JA_IMPORTADO')
    expect(r.documentId).toBe(docId)
  })

  it('recusa apropriação que não fecha com o total', async () => {
    const res = await api('POST', `/api/documents/${docId}/approve`, { allocations: [{ projectId: projectA, category: 'MATERIAIS', amount: 7_000_00 }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('APROPRIACAO_DIVERGENTE')
  })

  it('aprova com rateio entre duas obras e gera os títulos do XML', async () => {
    const res = await api('POST', `/api/documents/${docId}/approve`, {
      allocations: [
        { projectId: projectA, category: 'MATERIAIS', amount: 6_000_00 },
        { projectId: projectB, category: 'MATERIAIS', amount: 2_000_00 },
      ],
    })
    expect(res.statusCode).toBe(200)
    const doc = res.json()
    expect(doc.status).toBe('APROVADO')
    expect(doc.allocations).toHaveLength(2)
    expect(doc.payables.map((p: any) => p.amount)).toEqual([4_000_00, 4_000_00])
  })

  it('calcula a posição das obras e alerta orçamento', async () => {
    const res = await api('GET', `/api/projects/${projectA}`)
    const p = res.json()
    expect(p.financials.appropriated).toBe(6_000_00)
    expect(p.financials.open).toBe(6_000_00)
    expect(p.financials.committedPct).toBe(60)
    // 60% não alerta; nova nota de 3.000 leva a 90% → crítico
    const r2 = (await upload(nfe(1002, { items: [{ description: 'AREIA MEDIA LAVADA', unit: 'M3', quantity: 20, unitPrice: 150 }], installments: [] }))).json().results[0]
    expect(r2.document.issues.map((i: any) => i.code)).toContain('SEM_PARCELAS')
    const ap = await api('POST', `/api/documents/${r2.documentId}/approve`, { allocations: [{ projectId: projectA, category: 'MATERIAIS', amount: 3_000_00 }] })
    expect(ap.statusCode).toBe(200)
    expect(ap.json().payables).toHaveLength(1)
    const alerts = (await api('GET', '/api/alerts')).json()
    expect(alerts.some((a: any) => a.type === 'ORCAMENTO' && a.projectId === projectA && a.severity === 'CRITICO')).toBe(true)
    // categoria materiais: 9.000 > 8.000 orçados
    expect(alerts.some((a: any) => a.type === 'ORCAMENTO' && a.title.startsWith('Materiais acima'))).toBe(true)
  })

  it('registra pagamento parcial e total', async () => {
    const pays = (await api('GET', `/api/payables?projectId=${projectA}`)).json()
    const t = pays.find((p: any) => p.amount === 4_000_00)
    const over = await api('POST', `/api/payables/${t.id}/payments`, { amount: 5_000_00, paidAt: '2030-01-10' })
    expect(over.statusCode).toBe(400)
    const p1 = await api('POST', `/api/payables/${t.id}/payments`, { amount: 1_000_00, paidAt: '2030-01-10' })
    expect(p1.json().status).toBe('PARCIAL')
    const p2 = await api('POST', `/api/payables/${t.id}/payments`, { amount: 3_000_00, paidAt: '2030-01-11', method: 'PIX' })
    expect(p2.json().status).toBe('PAGO')
  })

  it('não cancela nota com pagamento', async () => {
    const res = await api('POST', `/api/documents/${docId}/cancel`, { reason: 'teste' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('POSSUI_PAGAMENTO')
  })

  it('detecta duplicidade (mesmo número, outra chave) e exige confirmação', async () => {
    const r = (await upload(nfe(1001, { cNF: 12345678 }))).json().results[0]
    expect(r.status).toBe('CRIADO')
    expect(r.document.status).toBe('EM_REVISAO')
    expect(r.document.issues.map((i: any) => i.code)).toContain('POSSIVEL_DUPLICIDADE')
    const res = await api('POST', `/api/documents/${r.documentId}/approve`, { allocations: [{ projectId: projectA, category: 'MATERIAIS', amount: 8_000_00 }] })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('PENDENCIA_CRITICA')
    const rej = await api('POST', `/api/documents/${r.documentId}/reject`, { reason: 'Nota duplicada' })
    expect(rej.json().status).toBe('REJEITADO')
  })

  it('marca nota emitida para outro CNPJ e sem obra', async () => {
    const r = (await upload(nfe(1003, { recipientCnpj: otherCnpj, extraInfo: 'sem referencia' }))).json().results[0]
    const codes = r.document.issues.map((i: any) => i.code)
    expect(codes).toContain('DESTINATARIO_DIVERGENTE')
    expect(codes).toContain('OBRA_NAO_IDENTIFICADA')
    expect(r.document.status).toBe('EM_REVISAO')
  })

  it('rejeita arquivo que não é NF-e', async () => {
    const r = (await upload('<pedido><x>1</x></pedido>', 'pedido.xml')).json().results[0]
    expect(r.status).toBe('ERRO')
  })

  it('isola dados entre construtoras', async () => {
    const res = await api('GET', `/api/documents/${docId}`, undefined, otherToken)
    expect(res.statusCode).toBe(404)
    const list = (await api('GET', '/api/documents', undefined, otherToken)).json()
    expect(list).toHaveLength(0)
    const proj = await api('GET', `/api/projects/${projectA}`, undefined, otherToken)
    expect(proj.statusCode).toBe(404)
  })

  it('fornecedor e obra listam totais e notas corretamente', async () => {
    const sup = (await api('GET', '/api/suppliers')).json().find((s: any) => s.cnpj === supplierCnpj)
    expect(sup.documentsCount).toBe(2)
    expect(Number(sup.purchasedTotal)).toBe(11_000_00)
    const proj = (await api('GET', `/api/projects/${projectA}`)).json()
    expect(proj.documents.length).toBeGreaterThanOrEqual(2)
    expect(proj.payables.length).toBe(3)
  })

  it('admin cria acesso para a equipe e a pessoa troca a senha', async () => {
    const email = `fin${rnd()}@teste.com`
    const res = await api('POST', '/api/users', { name: 'Financeiro Teste', email, role: 'FINANCEIRO' })
    expect(res.statusCode).toBe(201)
    const temp = res.json().password as string
    expect(temp.length).toBeGreaterThanOrEqual(10)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: temp } })
    const tk = login.json().token as string
    // financeiro não gerencia equipe
    expect((await api('GET', '/api/users', undefined, tk)).statusCode).toBe(403)
    expect((await api('POST', '/api/auth/password', { current: 'errada', next: 'novasenha123' }, tk)).statusCode).toBe(400)
    expect((await api('POST', '/api/auth/password', { current: temp, next: 'novasenha123' }, tk)).statusCode).toBe(200)
    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'novasenha123' } })
    expect(relogin.statusCode).toBe(200)
  })

  it('exporta CSV no formato do Excel brasileiro', async () => {
    const res = await api('GET', '/api/exports/lancamentos.csv')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const lines = res.body.replace('﻿', '').trim().split('\r\n')
    expect(lines[0]).toContain('Emissão;NF;Fornecedor')
    expect(lines).toHaveLength(4) // cabeçalho + 2 apropriações (rateio) + 1 nota
    expect(res.body).toContain('6000,00')
    const pay = await api('GET', '/api/exports/payables.csv?status=ABERTO,PARCIAL,PAGO')
    expect(pay.body.trim().split('\r\n').length).toBe(4)
  })

  it('dashboard consolida a construtora', async () => {
    const d = (await api('GET', '/api/dashboard')).json()
    expect(d.kpis.activeProjects).toBe(2)
    expect(d.kpis.appropriatedCost).toBe(11_000_00)
    expect(d.kpis.openPayables).toBe(7_000_00)
    expect(d.projects.find((p: any) => p.id === projectA).committedPct).toBe(90)
  })
})

describe('notas de serviço (NFS-e)', () => {
  const cnpj = cnpjWithDigits(rnd() + '0001')
  const prestador = cnpjWithDigits(rnd() + '0001')
  let tk = ''
  let apiKey = ''
  let obra = ''
  let docId = ''
  const nfse = (n: number, opts: Partial<Parameters<typeof buildNfseXml>[0]> = {}) =>
    buildNfseXml({
      layout: 'NACIONAL',
      number: n,
      issueDate: new Date().toISOString().slice(0, 10) + 'T09:00:00-03:00',
      issuer: { cnpj: prestador, name: 'Empreiteira Teste Ltda' },
      recipientCnpj: cnpj,
      description: 'Mão de obra de alvenaria - medição 2',
      serviceCode: '07.02',
      services: 10000,
      issRate: 0.03,
      issRetained: true,
      inss: 1100,
      obra: 'S-01',
      ...opts,
    }).xml

  beforeAll(async () => {
    const c = await makeCompany(cnpj, `t${rnd()}@teste.com`)
    tk = c.token
    apiKey = c.company.apiKey!
    ;[{ id: obra }] = await db.insert(projects).values({ companyId: c.company.id, code: 'S-01', name: 'Edifício Serviço', budgetTotal: 500_000_00 }).returning()
  })

  it('lê a NFS-e nacional: custo bruto, retenções e líquido; acha a obra pelo código', async () => {
    const r = (await upload(nfse(77), 'nfse.xml', tk)).json().results[0]
    expect(r.status).toBe('CRIADO')
    const d = r.document
    expect(d.type).toBe('NFSE')
    expect(d.number).toBe('77')
    expect(d.accessKey).toHaveLength(50)
    expect(d.totalAmount).toBe(10_000_00)
    expect(d.payableAmount).toBe(8_600_00)
    expect(d.service).toMatchObject({ layout: 'NACIONAL', serviceCode: '07.02', issRetained: true, retainedCents: 1_400_00, netCents: 8_600_00 })
    expect(d.service.retentions).toMatchObject({ iss: 300_00, inss: 1_100_00 })
    expect(d.suggestedProjectId).toBe(obra)
    expect(d.category).toBe('TERCEIRIZADOS')
    expect(d.status).toBe('EM_REVISAO')
    const codes = d.issues.map((i: any) => i.code)
    expect(codes).toContain('RETENCOES')
    expect(codes).not.toContain('CHAVE_INVALIDA')
    expect(codes).not.toContain('SEM_PROTOCOLO')
    expect(d.items).toHaveLength(1)
    docId = r.documentId
  })

  it('reenvio da mesma NFS-e não duplica', async () => {
    const r = (await upload(nfse(77), 'nfse-de-novo.xml', tk)).json().results[0]
    expect(r.status).toBe('JA_IMPORTADO')
    expect(r.documentId).toBe(docId)
  })

  it('títulos somam o líquido; o custo da obra fica com o total', async () => {
    const alloc = [{ projectId: obra, category: 'TERCEIRIZADOS', amount: 10_000_00 }]
    const bad = await api('POST', `/api/documents/${docId}/approve`, { allocations: alloc, installments: [{ dueDate: '2030-01-10', amount: 10_000_00 }] }, tk)
    expect(bad.statusCode).toBe(400)
    expect(bad.json().code).toBe('PARCELAS_DIVERGENTES')
    expect(bad.json().message).toContain('líquido')
    const ok = await api('POST', `/api/documents/${docId}/approve`, { allocations: alloc }, tk)
    expect(ok.statusCode).toBe(200)
    expect(ok.json().payables.map((p: any) => p.amount)).toEqual([8_600_00])
    expect(ok.json().allocations.map((a: any) => a.amount)).toEqual([10_000_00])
    const d = (await api('GET', '/api/dashboard', undefined, tk)).json()
    expect(d.kpis.appropriatedCost).toBe(10_000_00)
    expect(d.kpis.openPayables).toBe(8_600_00)
  })

  it('valor de NFS-e não pode ser editado à mão', async () => {
    const r = (await upload(nfse(78, { issRetained: false, inss: 0 }), 'nfse78.xml', tk)).json().results[0]
    const res = await api('PATCH', `/api/documents/${r.documentId}`, { totalAmount: 1 }, tk)
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALOR_XML')
    expect(r.document.payableAmount).toBe(r.document.totalAmount)
  })

  it('ABRASF cancelada vira pendência crítica; NF-e e NFS-e com o mesmo número não são duplicidade', async () => {
    await upload(nfe(90, { issuer: { cnpj: prestador, name: 'Empreiteira Teste Ltda' }, recipientCnpj: cnpj, extraInfo: 'Obra S-01' }), 'nfe90.xml', tk)
    const r = (await upload(nfse(90, { layout: 'ABRASF', cancelled: true, services: 4321 }), 'abrasf.xml', tk)).json().results[0]
    expect(r.status).toBe('CRIADO')
    const codes = r.document.issues.map((i: any) => i.code)
    expect(codes).toContain('NFSE_CANCELADA')
    expect(codes).not.toContain('POSSIVEL_DUPLICIDADE')
  })

  it('pacote do contador traz as retenções e o líquido de cada NFS-e', async () => {
    const { unzipSync, strFromU8 } = await import('fflate')
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const r = await api('GET', `/api/exports/notas-contador.zip?from=${today}&to=${today}`, undefined, tk)
    expect(r.statusCode).toBe(200)
    const zip = unzipSync(new Uint8Array(r.rawPayload))
    const lines = strFromU8(zip['notas.csv']).replace('\ufeff', '').trim().split('\r\n')
    expect(lines[0]).toContain('ISS retido;INSS retido;IR retido;PIS/COFINS/CSLL retidos;Valor líquido pago')
    const row = lines.find((l) => l.includes(';NFS-e;77;'))!
    expect(row).toContain('10000,00;300,00;1100,00;0,00;0,00;8600,00')
    expect(Object.keys(zip).some((f) => f.startsWith('XML/') && f.includes('NFSe-77'))).toBe(true)
    expect(strFromU8(zip['LEIA-ME.txt'])).toContain('Retenções nas NFS-e')
  })

  it('chega pela integração (n8n/e-mail) no padrão da Nota Paulistana', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/nfe',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/xml', 'x-filename': 'nfse-sp.xml' },
      payload: nfse(5500, { layout: 'SP', issRetained: false, inss: 1100 }),
    })
    expect(res.statusCode).toBe(200)
    const r = res.json().results[0]
    expect(r.status).toBe('CRIADO')
    const d = (await api('GET', `/api/documents/${r.documentId}`, undefined, tk)).json()
    expect(d.type).toBe('NFSE')
    expect(d.payableAmount).toBe(8_900_00)
  })
})

describe('CNPJ alfanumérico', () => {
  const alnum = (n: number) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 34)]).join('')
  const empresa = cnpjWithDigits(alnum(8) + '0001')
  const fornecedor = cnpjWithDigits(alnum(8) + '0001')
  let tk = ''

  beforeAll(async () => {
    tk = (await makeCompany(empresa, `t${rnd()}@teste.com`)).token
  })

  it('NF-e de fornecedor com CNPJ alfanumérico para construtora alfanumérica entra sem pendência de CNPJ ou chave', async () => {
    const xml = buildNfeXml({
      number: 1,
      issueDate: new Date().toISOString().slice(0, 10) + 'T10:00:00-03:00',
      issuer: { cnpj: fornecedor, name: 'Fornecedor Alfa Ltda' },
      recipientCnpj: empresa,
      items: [{ description: 'AREIA MEDIA LAVADA', ncm: '25059000', unit: 'M3', quantity: 10, unitPrice: 150 }],
      installments: [{ dueDate: '2030-01-10', amount: 1500 }],
    }).xml
    const r = (await upload(xml, 'alfa.xml', tk)).json().results[0]
    expect(r.status).toBe('CRIADO')
    const codes = r.document.issues.map((i: any) => i.code)
    expect(codes).not.toContain('CNPJ_EMITENTE_INVALIDO')
    expect(codes).not.toContain('CHAVE_INVALIDA')
    expect(codes).not.toContain('DESTINATARIO_DIVERGENTE')
    expect(r.document.supplier.cnpj).toBe(fornecedor)
    expect((await upload(xml, 'alfa-de-novo.xml', tk)).json().results[0].status).toBe('JA_IMPORTADO')
  })

  it('cadastro de fornecedor aceita o CNPJ digitado com máscara e minúsculas; busca acha pelo pedaço', async () => {
    const outro = cnpjWithDigits(alnum(8) + '0001')
    const masked = formatCnpj(outro).toLowerCase()
    const res = await api('POST', '/api/suppliers', { cnpj: masked, name: 'Prestador Beta' }, tk)
    expect(res.statusCode).toBe(201)
    expect(res.json().cnpj).toBe(outro)
    const bad = await api('POST', '/api/suppliers', { cnpj: outro.slice(0, 12) + '00', name: 'Errado' }, tk)
    expect(bad.json().code).toBe('CNPJ_INVALIDO')
    const list = (await api('GET', `/api/suppliers?q=${encodeURIComponent(outro.slice(2, 8).toLowerCase())}`, undefined, tk)).json()
    expect(list.map((s: any) => s.cnpj)).toContain(outro)
  })
})

describe('painel da plataforma', () => {
  let ownerToken = ''
  let pilotId = ''
  let pilotAdminEmail = ''
  let pilotAdminPassword = ''
  let pilotKey = ''

  beforeAll(async () => {
    const o = await makeCompany(cnpjWithDigits(rnd() + '0001'), `dona${rnd()}@operaia.com`)
    await db.update(users).set({ isPlatformOwner: true }).where(eq(users.companyId, o.company.id))
    const email = (await db.query.users.findFirst({ where: eq(users.companyId, o.company.id) }))!.email
    ownerToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha123' } })).json().token
  })

  it('só a dona acessa', async () => {
    expect((await api('GET', '/api/platform/overview')).statusCode).toBe(403)
    const ov = await api('GET', '/api/platform/overview', undefined, ownerToken)
    expect(ov.statusCode).toBe(200)
    expect(ov.json().companies.length).toBeGreaterThanOrEqual(3)
  })

  it('cria construtora com o primeiro admin', async () => {
    pilotAdminEmail = `admin${rnd()}@piloto.com`
    const res = await api('POST', '/api/platform/companies', { name: 'Piloto Teste', cnpj: cnpjWithDigits(rnd() + '0001'), adminName: 'Admin Piloto', adminEmail: pilotAdminEmail }, ownerToken)
    expect(res.statusCode).toBe(201)
    pilotId = res.json().company.id
    pilotKey = res.json().company.apiKey
    pilotAdminPassword = res.json().password
    createdCompanies.push(pilotId)
    // e-mail repetido não deixa construtora órfã
    const dup = await api('POST', '/api/platform/companies', { name: 'Dup', cnpj: cnpjWithDigits(rnd() + '0001'), adminName: 'Outra Pessoa', adminEmail: pilotAdminEmail }, ownerToken)
    expect(dup.statusCode).toBe(409)
    const ov = (await api('GET', '/api/platform/overview', undefined, ownerToken)).json()
    expect(ov.companies.some((c: any) => c.name === 'Dup')).toBe(false)
  })

  it('suspender bloqueia login, sessão aberta e integração na hora', async () => {
    const pilotToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: pilotAdminEmail, password: pilotAdminPassword } })).json().token
    expect((await api('GET', '/api/dashboard', undefined, pilotToken)).statusCode).toBe(200)
    expect((await api('PATCH', `/api/platform/companies/${pilotId}`, { status: 'SUSPENSA', notes: 'fim do piloto' }, ownerToken)).statusCode).toBe(200)
    expect((await api('GET', '/api/dashboard', undefined, pilotToken)).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: pilotAdminEmail, password: pilotAdminPassword } })).statusCode).toBe(403)
    const integ = await app.inject({ method: 'POST', url: '/api/integrations/nfe', headers: { 'x-api-key': pilotKey, 'content-type': 'application/xml' }, payload: '<x/>' })
    expect(integ.statusCode).toBe(403)
    await api('PATCH', `/api/platform/companies/${pilotId}`, { status: 'ATIVA' }, ownerToken)
    expect((await api('GET', '/api/dashboard', undefined, pilotToken)).statusCode).toBe(200)
    const detail = (await api('GET', `/api/platform/companies/${pilotId}`, undefined, ownerToken)).json()
    expect(detail.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['suspended', 'reactivated']))
  })

  it('entra como a construtora para suporte e volta', async () => {
    const imp = await api('POST', `/api/platform/companies/${pilotId}/impersonate`, undefined, ownerToken)
    const t = imp.json().token
    const meRes = (await api('GET', '/api/auth/me', undefined, t)).json()
    expect(meRes.company.id).toBe(pilotId)
    expect(meRes.impersonating).toBe(true)
    // equipe da construtora não lista a dona
    const team = (await api('GET', '/api/users', undefined, t)).json()
    expect(team.map((u: any) => u.email)).toEqual([pilotAdminEmail])
    const back = (await api('POST', '/api/platform/return', undefined, t)).json().token
    expect((await api('GET', '/api/auth/me', undefined, back)).json().impersonating).toBe(false)
  })

  it('desativa pessoa e reseta senha', async () => {
    const detail = (await api('GET', `/api/platform/companies/${pilotId}`, undefined, ownerToken)).json()
    const admin = detail.users[0]
    const reset = (await api('POST', `/api/platform/users/${admin.id}/reset-password`, undefined, ownerToken)).json()
    const tk = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: pilotAdminEmail, password: reset.password } })).json().token
    expect(tk).toBeTruthy()
    await api('PATCH', `/api/platform/users/${admin.id}`, { active: false }, ownerToken)
    expect((await api('GET', '/api/dashboard', undefined, tk)).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: pilotAdminEmail, password: reset.password } })).statusCode).toBe(403)
  })
})

describe('medição de acerto das sugestões', () => {
  let owner = ''
  let tk = ''
  let companyId = ''
  let obraA = ''
  let obraB = ''
  const cnpj = cnpjWithDigits(rnd() + '0001')
  const doc = (n: number, extraInfo: string, installments?: { dueDate: string; amount: number }[]) =>
    buildNfeXml({
      number: n,
      issueDate: new Date().toISOString().slice(0, 10) + 'T10:00:00-03:00',
      issuer: { cnpj: supplierCnpj, name: 'Fornecedor Teste Ltda' },
      recipientCnpj: cnpj,
      items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', quantity: 10, unitPrice: 40 }],
      installments,
      extraInfo,
    }).xml

  beforeAll(async () => {
    const o = await makeCompany(cnpjWithDigits(rnd() + '0001'), `dona${rnd()}@operaia.com`)
    await db.update(users).set({ isPlatformOwner: true }).where(eq(users.companyId, o.company.id))
    const email = (await db.query.users.findFirst({ where: eq(users.companyId, o.company.id) }))!.email
    owner = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha123' }, remoteAddress: '10.7.0.1' })).json().token
    const c = await makeCompany(cnpj, `t${rnd()}@teste.com`)
    tk = c.token
    companyId = c.company.id
    ;[{ id: obraA }, { id: obraB }] = await db
      .insert(projects)
      .values([
        { companyId, code: 'AC-01', name: 'Residencial Acerto', budgetTotal: 100_000_00 },
        { companyId, code: 'AC-02', name: 'Galpão Outro', budgetTotal: 100_000_00 },
      ])
      .returning()
  })

  const approve = (id: string, projectId: string, category: string, installments?: { dueDate: string; amount: number }[]) =>
    api('POST', `/api/documents/${id}/approve`, { allocations: [{ projectId, category, amount: 400_00 }], installments, acknowledgeCritical: true }, tk)

  it('aprovar igual à sugestão conta acerto; trocar conta erro; sem obra conta "sem sugestão"', async () => {
    const d1 = (await upload(doc(1, 'Obra AC-01', [{ dueDate: '2030-02-10', amount: 400 }]), 'a1.xml', tk)).json().results[0]
    expect(d1.document.suggestedProjectId).toBe(obraA)
    expect((await approve(d1.documentId, obraA, d1.document.category)).statusCode).toBe(200)

    const d2 = (await upload(doc(2, 'Obra AC-01', [{ dueDate: '2030-02-10', amount: 400 }]), 'a2.xml', tk)).json().results[0]
    expect((await approve(d2.documentId, obraB, 'SERVICOS', [{ dueDate: '2030-03-10', amount: 400_00 }])).statusCode).toBe(200)

    const d3 = (await upload(doc(3, 'sem referência'), 'a3.xml', tk)).json().results[0]
    expect(d3.document.suggestedProjectId).toBeNull()
    expect((await approve(d3.documentId, obraA, d3.document.category)).statusCode).toBe(200)

    const rows = await db.select().from(suggestionChecks).where(eq(suggestionChecks.companyId, companyId))
    const of = (docId: string) => Object.fromEntries(rows.filter((r) => r.documentId === docId).map((r) => [r.field, r.outcome]))
    expect(of(d1.documentId)).toEqual({ obra: 'ACERTOU', categoria: 'ACERTOU', vencimento: 'ACERTOU' })
    expect(of(d2.documentId)).toEqual({ obra: 'ERROU', categoria: 'ERROU', vencimento: 'ERROU' })
    expect(of(d3.documentId)).toEqual({ obra: 'SEM_SUGESTAO', categoria: 'ACERTOU' })
  })

  it('relatório da dona: taxa por campo, por construtora e onde errou', async () => {
    expect((await api('GET', '/api/platform/accuracy', undefined, tk)).statusCode).toBe(403)
    const r = (await api('GET', `/api/platform/accuracy?days=30&companyId=${companyId}`, undefined, owner)).json()
    expect(r.target).toBe(95)
    expect(r.documentsMeasured).toBe(3)
    const f = Object.fromEntries(r.fields.map((x: any) => [x.field, x]))
    expect(f.obra).toMatchObject({ acertou: 1, errou: 1, semSugestao: 1, total: 3, rate: 33.3, precision: 50 })
    expect(f.categoria).toMatchObject({ acertou: 2, errou: 1, rate: 66.7 })
    expect(f.vencimento).toMatchObject({ acertou: 1, errou: 1, rate: 50 })
    expect(r.critical).toMatchObject({ acertou: 4, errou: 3, semSugestao: 1, total: 8, rate: 50 })
    expect(r.companies).toHaveLength(1)
    const obraMiss = r.misses.find((m: any) => m.field === 'obra' && m.outcome === 'ERROU')
    expect(obraMiss).toMatchObject({ suggested: 'AC-01 · Residencial Acerto', final: 'AC-02 · Galpão Outro', supplier: 'Fornecedor Teste Ltda' })
    expect(obraMiss.reason).toBeTruthy()
  })
})

describe('portal do proprietário e prévia da medição', () => {
  let tk = ''
  let companyId = ''
  let obra = ''
  let outra = ''
  let ownerTk = ''
  let ownerId = ''
  let docMaterial = ''
  let docOutra = ''
  const cnpj = cnpjWithDigits(rnd() + '0001')
  const ownerEmail = `dono${rnd()}@obra.com`
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const inject = (method: 'PUT' | 'DELETE', url: string, payload?: unknown, auth = tk) =>
    app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${auth}` } })
  const note = (n: number, extraInfo: string, unitPrice: number) =>
    buildNfeXml({
      number: n,
      issueDate: `${today}T10:00:00-03:00`,
      issuer: { cnpj: supplierCnpj, name: 'Fornecedor Teste Ltda' },
      recipientCnpj: cnpj,
      items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', quantity: 10, unitPrice }],
      extraInfo,
    }).xml

  beforeAll(async () => {
    const c = await makeCompany(cnpj, `t${rnd()}@teste.com`)
    tk = c.token
    companyId = c.company.id
    ;[{ id: obra }, { id: outra }] = await db
      .insert(projects)
      .values([
        { companyId, code: 'ADM-1', name: 'Casa do Seu João', budgetTotal: 500_000_00 },
        { companyId, code: 'ADM-2', name: 'Outra Obra', budgetTotal: 100_000_00 },
      ])
      .returning()
  })

  it('construtora configura o contrato por administração (taxa padrão de 15%, fechamento no fim do mês)', async () => {
    const p = await api('PATCH', `/api/projects/${obra}`, { contractType: 'ADMINISTRACAO', ownerName: 'João Proprietário', ownerEmail }, tk)
    expect(p.statusCode).toBe(200)
    const m = (await api('GET', `/api/projects/${obra}/measurement`, undefined, tk)).json()
    expect(m.contract).toMatchObject({ type: 'ADMINISTRACAO', adminFeeBps: 1500, adminFeeFromDefault: true, measurementDay: null, ownerPaysSuppliers: false })
    expect(m.period.month).toBe(today.slice(0, 7))
  })

  it('prévia: realizado por grupo + previsto (nota em conferência e pedido em aberto) + taxa sobre tudo', async () => {
    const d1 = (await upload(note(1, 'Obra ADM-1', 100), 'm1.xml', tk)).json().results[0] // R$ 1.000
    docMaterial = d1.documentId
    expect((await api('POST', `/api/documents/${d1.documentId}/approve`, { allocations: [{ projectId: obra, category: 'MATERIAIS', amount: 1_000_00 }], acknowledgeCritical: true }, tk)).statusCode).toBe(200)
    const d2 = (await upload(note(2, 'Obra ADM-1 mão de obra', 200), 'm2.xml', tk)).json().results[0] // R$ 2.000, rateio 50/50
    expect(
      (
        await api(
          'POST',
          `/api/documents/${d2.documentId}/approve`,
          { allocations: [{ projectId: obra, category: 'MAO_DE_OBRA', amount: 1_000_00 }, { projectId: outra, category: 'MAO_DE_OBRA', amount: 1_000_00 }], acknowledgeCritical: true },
          tk,
        )
      ).statusCode,
    ).toBe(200)
    const d3 = (await upload(note(3, 'Obra ADM-2', 50), 'm3.xml', tk)).json().results[0]
    docOutra = d3.documentId
    await api('POST', `/api/documents/${d3.documentId}/approve`, { allocations: [{ projectId: outra, category: 'MATERIAIS', amount: 500_00 }], acknowledgeCritical: true }, tk)
    // chegou e ainda não foi conferida: R$ 300
    const d4 = (await upload(note(4, 'Obra ADM-1', 30), 'm4.xml', tk)).json().results[0]
    expect(d4.document.status).not.toBe('APROVADO')
    // pedido aprovado, entrega até o fim do mês: R$ 700
    const [sup] = await db.select().from(suppliers).where(and(eq(suppliers.companyId, companyId), eq(suppliers.cnpj, supplierCnpj)))
    await db.insert(purchaseOrders).values({ companyId, number: 1, projectId: obra, supplierId: sup.id, status: 'APROVADO', total: 700_00, expectedDate: new Date(`${today}T12:00:00-03:00`) })

    const m = (await api('GET', `/api/projects/${obra}/measurement`, undefined, tk)).json()
    const g = Object.fromEntries(m.realized.groups.map((x: any) => [x.key, x.amount]))
    expect(g).toMatchObject({ materiais: 1_000_00, mao_de_obra: 1_000_00 })
    expect(m.realized.total).toBe(2_000_00)
    expect(m.realized.documents).toHaveLength(2)
    expect(m.forecast.total).toBe(1_000_00)
    expect(m.forecast.items.map((i: any) => i.kind).sort()).toEqual(['NOTA', 'PEDIDO'])
    expect(m.fee).toMatchObject({ pct: 15, onRealized: 300_00, onForecast: 150_00, total: 450_00 })
    expect(m.totals).toMatchObject({ realizedWithFee: 2_300_00, expectedCosts: 3_000_00, expected: 3_450_00, toSuppliers: 0, toBuilder: 3_450_00 })
  })

  it('proprietário paga as compras direto: à construtora vai só a taxa; taxa e fechamento próprios da obra', async () => {
    await api('PATCH', `/api/projects/${obra}`, { ownerPaysSuppliers: true, adminFeeBps: 1200, measurementDay: 25 }, tk)
    const m = (await api('GET', `/api/projects/${obra}/measurement?month=${today.slice(0, 7)}`, undefined, tk)).json()
    expect(m.contract).toMatchObject({ adminFeeBps: 1200, adminFeeFromDefault: false, measurementDay: 25 })
    expect(m.period.last).toBe(`${today.slice(0, 7)}-25`)
    if (Number(today.slice(8)) <= 25) {
      expect(m.fee.total).toBe(Math.round(3_000_00 * 0.12))
      expect(m.totals.toSuppliers).toBe(3_000_00)
      expect(m.totals.toBuilder).toBe(m.fee.total)
    }
    await api('PATCH', `/api/projects/${obra}`, { ownerPaysSuppliers: false, adminFeeBps: null, measurementDay: null }, tk)
  })

  it('padrões da construtora valem para as obras sem configuração própria', async () => {
    expect((await inject('PUT', '/api/company/contract-defaults', { adminFeeBps: 1000, measurementDay: null })).statusCode).toBe(200)
    const m = (await api('GET', `/api/projects/${obra}/measurement`, undefined, tk)).json()
    expect(m.fee.pct).toBe(10)
    await inject('PUT', '/api/company/contract-defaults', { adminFeeBps: 1500, measurementDay: null })
  })

  it('libera o portal: login do proprietário vê só a obra dele e nada do sistema', async () => {
    const inv = await api('POST', `/api/projects/${obra}/owners`, { name: 'João Proprietário', email: ownerEmail }, tk)
    expect(inv.statusCode).toBe(201)
    expect(inv.json().password).toBeTruthy()
    ownerId = inv.json().user.id
    expect((await api('GET', `/api/projects/${obra}/owners`, undefined, tk)).json().map((o: any) => o.email)).toEqual([ownerEmail])
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ownerEmail, password: inv.json().password }, remoteAddress: '10.6.0.1' })
    ownerTk = login.json().token
    const meRes = (await api('GET', '/api/auth/me', undefined, ownerTk)).json()
    expect(meRes.user.role).toBe('PROPRIETARIO')
    expect(meRes.permissions.projectIds).toEqual([obra])

    const list = (await api('GET', '/api/owner/projects', undefined, ownerTk)).json()
    expect(list.map((p: any) => p.id)).toEqual([obra])
    expect(list[0]).toMatchObject({ costToDate: 2_000_00, contract: { type: 'ADMINISTRACAO' } })
    const detail = (await api('GET', `/api/owner/projects/${obra}`, undefined, ownerTk)).json()
    expect(detail.documents).toHaveLength(2)
    expect(detail.measurement.totals.expected).toBe(3_450_00)
    expect(detail.news.firstVisit).toBe(true)

    // nada do sistema da construtora
    for (const url of ['/api/documents', '/api/projects', '/api/dashboard', '/api/payables', '/api/users', '/api/company/contract-defaults', `/api/projects/${obra}/measurement`]) {
      const r = await api('GET', url, undefined, ownerTk)
      expect(r.statusCode, url).toBe(403)
      expect(r.json().code).toBe('SO_PORTAL')
    }
    expect((await api('GET', `/api/owner/projects/${outra}`, undefined, ownerTk)).statusCode).toBe(404)
    // arquivo: nota da obra dele sim, da outra obra não
    expect((await api('GET', `/api/owner/documents/${docMaterial}/file`, undefined, ownerTk)).statusCode).toBe(200)
    expect((await api('GET', `/api/owner/documents/${docOutra}/file`, undefined, ownerTk)).statusCode).toBe(404)
    // quem não é proprietário não usa o portal
    expect((await api('GET', '/api/owner/projects', undefined, tk)).json().code).toBe('SO_PROPRIETARIO')
  })

  it('novidades: notas aprovadas depois da última visita', async () => {
    await api('POST', '/api/owner/seen', {}, ownerTk)
    const d = (await upload(note(5, 'Obra ADM-1', 10), 'm5.xml', tk)).json().results[0]
    await api('POST', `/api/documents/${d.documentId}/approve`, { allocations: [{ projectId: obra, category: 'MATERIAIS', amount: 100_00 }], acknowledgeCritical: true }, tk)
    const detail = (await api('GET', `/api/owner/projects/${obra}`, undefined, ownerTk)).json()
    expect(detail.news).toMatchObject({ documents: 1, firstVisit: false })
    expect(detail.documents.find((x: any) => x.id === d.documentId).isNew).toBe(true)
  })

  it('administrador confere o portal "vendo como" o proprietário (só leitura)', async () => {
    const v = await api('POST', `/api/users/${ownerId}/view-as`, {}, tk)
    expect(v.statusCode).toBe(200)
    const viewTk = v.json().token
    expect((await api('GET', '/api/owner/projects', undefined, viewTk)).json().map((p: any) => p.id)).toEqual([obra])
    expect((await api('GET', '/api/documents', undefined, viewTk)).statusCode).toBe(403)
    expect((await api('POST', '/api/owner/seen', {}, viewTk)).statusCode).toBe(403)
  })

  it('tirar a obra desativa o acesso do proprietário', async () => {
    expect((await inject('DELETE', `/api/projects/${obra}/owners/${ownerId}`)).json()).toMatchObject({ ok: true, active: false })
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ownerEmail, password: 'x'.repeat(10) }, remoteAddress: '10.6.0.2' })
    expect(login.statusCode).not.toBe(200)
    expect((await api('GET', '/api/owner/projects', undefined, ownerTk)).statusCode).not.toBe(200)
  })
})

describe('margem de contribuição por cliente', () => {
  let owner = ''
  let tk = ''
  let companyId = ''
  let before: any = null
  const cnpj = cnpjWithDigits(rnd() + '0001')
  const month = currentMonth()
  const prev = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).toISOString().slice(0, 7)
  const xmls: string[] = []

  beforeAll(async () => {
    const o = await makeCompany(cnpjWithDigits(rnd() + '0001'), `dona${rnd()}@operaia.com`)
    await db.update(users).set({ isPlatformOwner: true }).where(eq(users.companyId, o.company.id))
    // o token só ganha a área da plataforma num login novo
    const email = (await db.query.users.findFirst({ where: eq(users.companyId, o.company.id) }))!.email
    owner = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha123' }, remoteAddress: '10.8.0.1' })).json().token
    const c = await makeCompany(cnpj, `t${rnd()}@teste.com`)
    tk = c.token
    companyId = c.company.id
    before = (await api('GET', '/api/platform/margin', undefined, owner)).json().settings
    for (const n of [1, 2]) {
      const xml = buildNfeXml({
        number: n,
        issueDate: new Date().toISOString().slice(0, 10) + 'T10:00:00-03:00',
        issuer: { cnpj: supplierCnpj, name: 'Fornecedor Teste Ltda' },
        recipientCnpj: cnpj,
        items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', quantity: 10, unitPrice: 40 }],
      }).xml
      xmls.push(xml)
      expect((await upload(xml, `m${n}.xml`, tk)).json().results[0].status).toBe('CRIADO')
    }
  })
  afterAll(async () => {
    if (before) await api('PUT', '/api/platform/margin/settings', before, owner)
  })

  it('só a dona vê e altera', async () => {
    expect((await api('GET', '/api/platform/margin', undefined, tk)).statusCode).toBe(403)
    expect((await api('PUT', `/api/platform/companies/${companyId}/month-costs/${month}`, { supportMinutes: 1 }, tk)).statusCode).toBe(403)
    expect((await api('GET', '/api/platform/margin?month=2026-13', undefined, owner)).statusCode).toBe(400)
  })

  it('calcula receita, custos variáveis, margem e meta', async () => {
    const p = await api('PATCH', `/api/platform/companies/${companyId}`, { plan: 'ESSENCIAL', billingSince: month }, owner)
    expect(p.statusCode).toBe(200)
    expect(p.json().billing).toMatchObject({ plan: 'ESSENCIAL', monthlyFee: 399_00, billingSince: month })
    await api('PUT', '/api/platform/margin/settings', { storagePerGbCents: 1_000_000_000, supportHourCents: 60_00, paymentFeeBps: 199, paymentFixedCents: 3_49, fixedMonthlyCents: 500_00, targetPct: 70 }, owner)
    const mc = await api('PUT', `/api/platform/companies/${companyId}/month-costs/${month}`, { supportMinutes: 90, aiCost: 15_00, revenueAdjust: -39_00, notes: 'desconto de piloto' }, owner)
    expect(mc.statusCode).toBe(200)

    const m = (await api('GET', `/api/platform/margin?month=${month}`, undefined, owner)).json()
    const row = m.rows.find((r: any) => r.companyId === companyId)
    const bytes = xmls.reduce((a, x) => a + Buffer.byteLength(x), 0)
    expect(row.usage.storageBytes).toBe(bytes)
    expect(row.usage.documentsInMonth).toBe(2)
    expect(row.revenue).toBe(360_00)
    expect(row.costs).toEqual({ storage: Math.round((bytes / 1e9) * 1_000_000_000), payment: 716 + 349, support: 90_00, ai: 15_00, other: 0 })
    expect(row.variableCosts).toBe(row.costs.storage + 1065 + 90_00 + 15_00)
    expect(row.margin).toBe(360_00 - row.variableCosts)
    expect(row.marginPct).toBe(Math.round((row.margin / 360_00) * 1000) / 10)
    expect(row.marginStatus).toBe(row.marginPct >= 70 ? 'OK' : 'ABAIXO')
    expect(row.manual.notes).toBe('desconto de piloto')
    expect(m.totals.fixedCosts).toBe(500_00)
    expect(m.trend).toHaveLength(6)
    expect(m.trend[5].month).toBe(month)

    const old = (await api('GET', `/api/platform/margin?month=${prev}`, undefined, owner)).json()
    const r0 = old.rows.find((r: any) => r.companyId === companyId)
    // empresa criada neste mês não aparece no mês anterior
    expect(r0).toBeUndefined()
  })

  it('mede o tamanho dos arquivos antigos que não tinham tamanho anotado', async () => {
    await db.update(documents).set({ fileSize: null }).where(eq(documents.companyId, companyId))
    const m = (await api('GET', `/api/platform/margin?month=${month}`, undefined, owner)).json()
    const row = m.rows.find((r: any) => r.companyId === companyId)
    expect(row.usage.storageBytes).toBe(xmls.reduce((a, x) => a + Buffer.byteLength(x), 0))
  })

  it('cortesia não gera receita', async () => {
    await api('PATCH', `/api/platform/companies/${companyId}`, { plan: 'CORTESIA' }, owner)
    const row = (await api('GET', `/api/platform/margin?month=${month}`, undefined, owner)).json().rows.find((r: any) => r.companyId === companyId)
    expect(row.revenue).toBe(0)
    expect(row.marginStatus).toBe('SEM_RECEITA')
    expect(row.marginPct).toBeNull()
  })
})

describe('e-mail de notas (IMAP real em memória)', () => {
  let imapServer: any
  const IMAP_PORT = 11143
  const conn = { host: '127.0.0.1', port: IMAP_PORT, secure: false, username: 'notas@teste.com', password: 'senha-app-123', mailbox: 'INBOX' }

  async function deliver(xml: string | null, subject = 'NF-e') {
    const MailComposer = (await import('nodemailer/lib/mail-composer/index.js')).default as any
    const mail = new MailComposer({
      from: 'fornecedor@x.com',
      to: 'notas@teste.com',
      subject,
      text: 'Segue a nota.',
      attachments: xml ? [{ filename: 'NFe-teste.xml', content: xml, contentType: 'application/xml' }, { filename: 'danfe.pdf', content: Buffer.from('%PDF-1.4') }] : [],
    })
    const raw: Buffer = await mail.compile().build()
    const { ImapFlow } = await import('imapflow')
    const c = new ImapFlow({ host: '127.0.0.1', port: IMAP_PORT, secure: false, auth: { user: conn.username, pass: conn.password }, logger: false })
    await c.connect()
    await c.append('INBOX', raw, [])
    await c.logout()
  }

  beforeAll(async () => {
    const hoodiecrow = (await import('hoodiecrow-imap')).default as any
    imapServer = hoodiecrow({
      plugins: ['ID', 'SASL-IR', 'AUTH-PLAIN', 'NAMESPACE', 'IDLE', 'ENABLE', 'UNSELECT', 'LITERALPLUS', 'UIDPLUS', 'SPECIAL-USE'],
      storage: { INBOX: { messages: [] } },
      users: { [conn.username]: { password: conn.password } },
    })
    await new Promise<void>((res) => imapServer.listen(IMAP_PORT, res))
  })
  afterAll(() => imapServer?.close?.())

  it('senha errada vira mensagem clara e não salva', async () => {
    const res = await api('PUT', '/api/mail-inbox', { ...conn, password: 'errada' })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/senha/i)
    expect((await api('GET', '/api/mail-inbox')).json().inbox).toBeNull()
  })

  it('conecta, guarda a senha criptografada e não devolve a senha', async () => {
    const res = await api('PUT', '/api/mail-inbox', conn)
    expect(res.statusCode).toBe(200)
    expect(res.json().test.ok).toBe(true)
    const inbox = (await api('GET', '/api/mail-inbox')).json().inbox
    expect(inbox.username).toBe(conn.username)
    expect(inbox.hasPassword).toBe(true)
    expect(JSON.stringify(inbox)).not.toContain(conn.password)
  })

  it('lê a caixa: importa o XML, ignora o PDF e e-mails sem anexo', async () => {
    await deliver(nfe(3001, { extraInfo: 'Obra: Residencial Teste' }))
    await deliver(null, 'Bom dia')
    const res = (await api('POST', '/api/mail-inbox/check')).json()
    expect(res.result.ok).toBe(true)
    expect(res.result.messages).toBe(2)
    expect(res.result.created).toBe(1)
    expect(res.inbox.documentsReceived).toBe(1)
    const docs = (await api('GET', '/api/documents?q=3001')).json()
    expect(docs[0].source).toBe('EMAIL')
    // segunda leitura: nada novo (já marcadas como lidas)
    expect((await api('POST', '/api/mail-inbox/check')).json().result.messages).toBe(0)
    // fornecedor reenvia a mesma nota: reconhece e não duplica
    await deliver(nfe(3001, { extraInfo: 'Obra: Residencial Teste' }), 'reenvio')
    const again = (await api('POST', '/api/mail-inbox/check')).json().result
    expect(again.created).toBe(0)
    expect(again.duplicates).toBe(1)
  })

  it('erro de leitura fica registrado e aparece na plataforma; pausar e remover', async () => {
    imapServer.users[conn.username].password = 'trocada'
    const res = (await api('POST', '/api/mail-inbox/check')).json()
    expect(res.result.ok).toBe(false)
    expect(res.inbox.lastError).toMatch(/senha/i)
    imapServer.users[conn.username].password = conn.password
    expect((await api('POST', '/api/mail-inbox/pause')).json().inbox.enabled).toBe(false)
    expect((await api('DELETE', '/api/mail-inbox')).json().inbox).toBeNull()
  })
})

describe('foto da obra', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
  function sendImage(content: Buffer, project = projectA, auth = token) {
    const boundary = '----operaia' + rnd()
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return app.inject({ method: 'POST', url: `/api/projects/${project}/image`, headers: { authorization: `Bearer ${auth}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
  }

  it('envia, serve sem login, troca e remove', async () => {
    const res = await sendImage(png)
    expect(res.statusCode).toBe(200)
    const url = res.json().imageUrl as string
    expect(url).toMatch(/^\/api\/media\/obras\/[a-f0-9]{32}\.png$/)
    const served = await app.inject({ method: 'GET', url })
    expect(served.statusCode).toBe(200)
    expect(served.headers['content-type']).toContain('image/png')

    const again = await sendImage(png)
    expect(again.json().imageUrl).not.toBe(url)
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404) // a antiga é apagada

    const del = await app.inject({ method: 'DELETE', url: `/api/projects/${projectA}/image`, headers: { authorization: `Bearer ${token}` } })
    expect(del.json().imageUrl).toBeNull()
  })

  it('recusa arquivo que não é imagem e obra de outra construtora', async () => {
    expect((await sendImage(Buffer.from('<svg onload="x"/>'))).json().code).toBe('IMAGEM_INVALIDA')
    expect((await sendImage(png, projectA, otherToken)).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/media/obras/../../segredo.png' })).statusCode).toBe(404)
  })
})

describe('fornecedor homologado', () => {
  it('registra quando e quem homologou e filtra por situação', async () => {
    const created = await api('POST', '/api/suppliers', { cnpj: cnpjWithDigits(rnd() + '0001'), name: 'Fornecedor Homologação' })
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    expect(created.json().homologatedAt).toBeNull()

    const ok = await api('PATCH', `/api/suppliers/${id}`, { status: 'HOMOLOGADO' })
    expect(ok.json().homologatedAt).toBeTruthy()
    expect(ok.json().homologatedBy).toBe('Teste')

    const list = (await api('GET', '/api/suppliers?status=HOMOLOGADO')).json() as { id: string }[]
    expect(list.some((s) => s.id === id)).toBe(true)
    expect(((await api('GET', '/api/suppliers?status=PENDENTE')).json() as { id: string }[]).some((s) => s.id === id)).toBe(false)

    const blocked = await api('PATCH', `/api/suppliers/${id}`, { status: 'BLOQUEADO' })
    expect(blocked.json().homologatedAt).toBeNull()
  })
})

describe('relatórios', () => {
  it('soma por obra, fornecedor e mês bate com o total, e só vê a própria construtora', async () => {
    const r = (await api('GET', '/api/reports')).json()
    expect(r.total).toBeGreaterThan(0)
    const sum = (xs: { total: number }[]) => xs.reduce((a, x) => a + x.total, 0)
    expect(sum(r.byProject)).toBe(r.total)
    expect(sum(r.bySupplier)).toBe(r.total)
    expect(sum(r.byMonth)).toBe(r.total)
    expect(r.byProject.every((p: { projectId: string }) => [projectA, projectB].includes(p.projectId))).toBe(true)

    const other = (await api('GET', '/api/reports', undefined, otherToken)).json()
    expect(other.byProject.some((p: { projectId: string }) => p.projectId === projectA)).toBe(false)

    const csv = await api('GET', '/api/exports/relatorio-fornecedores.csv')
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.body.split('\r\n')[0]).toContain('Fornecedor;CNPJ;Categoria principal')
    expect((await api('GET', '/api/exports/relatorio-xyz.csv')).statusCode).toBe(400)
  })
})

describe('preços do fornecedor', () => {
  it('mostra último preço, média e prazo de pagamento só da própria construtora', async () => {
    const list = (await api('GET', '/api/suppliers?')).json() as { id: string; topItem: unknown; avgPaymentTermDays: number | null; documentsCount: number }[]
    const withNotes = list.find((s) => s.documentsCount > 0)
    expect(withNotes).toBeTruthy()
    expect(withNotes!.topItem).toBeTruthy()
    expect(withNotes!.avgPaymentTermDays).not.toBeNull()

    const prices = (await api('GET', `/api/suppliers/${withNotes!.id}/prices`)).json()
    expect(prices.materials.length).toBeGreaterThan(0)
    const m = prices.materials[0]
    expect(m.lastPrice).toBeGreaterThan(0)
    expect(m.purchases).toBeGreaterThan(0)

    expect((await api('GET', `/api/suppliers/${withNotes!.id}/prices`, undefined, otherToken)).statusCode).toBe(404)
  })
})

describe('compras: pedido × nota', () => {
  const buyCnpj = cnpjWithDigits(rnd() + '0001')
  let supplierId = ''
  let orderId = ''
  const nota = (n: number, opts: Partial<Parameters<typeof buildNfeXml>[0]>) =>
    nfe(n, { issuer: { cnpj: buyCnpj, name: 'Depósito Compras Ltda' }, extraInfo: undefined, installments: [], ...opts })

  it('cria pedido em rascunho e aprova', async () => {
    const s = await api('POST', '/api/suppliers', { cnpj: buyCnpj, name: 'Depósito Compras Ltda', status: 'HOMOLOGADO' })
    supplierId = s.json().id
    const res = await api('POST', '/api/purchase-orders', {
      projectId: projectB,
      supplierId,
      expectedDate: new Date().toISOString().slice(0, 10),
      items: [
        { description: 'Cimento CP II 50kg', unit: 'sc', quantity: 100, unitPrice: 38.9 },
        { description: 'Areia média lavada', unit: 'm3', quantity: 10, unitPrice: 145 },
      ],
    })
    expect(res.statusCode).toBe(201)
    const o = res.json()
    expect(o.status).toBe('RASCUNHO')
    expect(o.code).toMatch(/^PC-\d{4}$/)
    expect(o.total).toBe(100 * 38_90 + 10 * 145_00)
    orderId = o.id
    expect((await api('POST', `/api/purchase-orders/${orderId}/approve`)).json().status).toBe('APROVADO')
    expect((await api('GET', `/api/purchase-orders/${orderId}`, undefined, otherToken)).statusCode).toBe(404)
  })

  it('nota com o número do pedido é vinculada sozinha e herda a obra', async () => {
    const code = (await api('GET', `/api/purchase-orders/${orderId}`)).json().code
    const r = (await upload(nota(5001, { purchaseOrder: code, items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', quantity: 60, unitPrice: 38.9 }] }))).json().results[0]
    expect(r.document.purchaseOrderId).toBe(orderId)
    expect(r.document.suggestedProjectId).toBe(projectB)
    const codes = r.document.issues.map((i: any) => i.code)
    expect(codes).not.toContain('OBRA_NAO_IDENTIFICADA')
    expect(codes.filter((c: string) => c.startsWith('PEDIDO_'))).toEqual([])
    const ap = await api('POST', `/api/documents/${r.documentId}/approve`, { allocations: [{ projectId: projectB, category: 'MATERIAIS', amount: r.document.totalAmount }] })
    expect(ap.statusCode).toBe(200)
    const o = (await api('GET', `/api/purchase-orders/${orderId}`)).json()
    expect(o.status).toBe('PARCIAL')
    expect(o.items.find((i: any) => i.unit === 'SC').receivedQty).toBe(60)
    const stats = (await api('GET', `/api/suppliers/${supplierId}/prices`)).json().delivery
    expect(stats.deliveries).toBe(1)
    expect(stats.onTimePct).toBe(100)
  })

  it('nota sem pedido: avisa, sugere o pedido e confere preço e quantidade ao vincular', async () => {
    const r = (await upload(nota(5002, { items: [{ description: 'CIMENTO CP II 50KG', ncm: '25232910', unit: 'SC', quantity: 60, unitPrice: 42 }] }))).json().results[0]
    expect(r.document.issues.map((i: any) => i.code)).toContain('SEM_PEDIDO')
    expect(r.document.orderCandidates.map((c: any) => c.id)).toContain(orderId)

    const linked = (await api('POST', `/api/documents/${r.documentId}/purchase-order`, { orderId })).json()
    const codes = linked.issues.map((i: any) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['PEDIDO_PRECO', 'PEDIDO_QTD']))
    expect(codes).not.toContain('SEM_PEDIDO')
    expect(linked.status).toBe('EM_REVISAO')
    expect(linked.orderConference[0].priceDiffPct).toBeCloseTo(7.97, 1)
    const open = (await api('GET', '/api/alerts')).json().filter((a: any) => a.type === 'PEDIDO' && a.documentId === r.documentId)
    expect(open.length).toBe(1)
    expect((await api('GET', '/api/purchase-orders')).json().find((o: any) => o.id === orderId).divergent).toBe(true)

    const unlinked = (await api('POST', `/api/documents/${r.documentId}/purchase-order`, { orderId: null })).json()
    expect(unlinked.issues.map((i: any) => i.code)).toContain('SEM_PEDIDO')
    expect((await api('GET', '/api/alerts')).json().some((a: any) => a.type === 'PEDIDO' && a.documentId === r.documentId)).toBe(false)
  })

  it('não cancela pedido com nota aprovada', async () => {
    const res = await api('POST', `/api/purchase-orders/${orderId}/cancel`, { reason: 'teste' })
    expect(res.statusCode).toBe(409)
  })
})

describe('app de obra (mestre)', () => {
  let mestre = ''
  let stageId = ''
  let requestId = ''
  let orderId = ''
  const fieldCnpj = cnpjWithDigits(rnd() + '0001')
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')

  beforeAll(async () => {
    const email = `m${rnd()}@teste.com`
    const [u] = await db.insert(users).values({ companyId: createdCompanies[0], name: 'Mestre Zé', email, passwordHash: await bcrypt.hash('senha123', 4), role: 'MESTRE' }).returning()
    // o login tem limite de tentativas por IP; nos testes o token é emitido direto
    mestre = app.jwt.sign({ sub: u.id, companyId: u.companyId, role: 'MESTRE', name: u.name })
  })

  it('mestre só acessa o app de obra e não vê valores', async () => {
    expect((await api('GET', '/api/projects', undefined, mestre)).statusCode).toBe(403)
    expect((await api('GET', '/api/payables', undefined, mestre)).statusCode).toBe(403)
    const res = await api('GET', '/api/field/projects', undefined, mestre)
    expect(res.statusCode).toBe(200)
    expect(res.json().map((p: any) => p.id)).toContain(projectB)
    const detail = await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)
    expect(detail.body).not.toMatch(/"(total|unitPrice|budgetTotal|amount)"/)
    expect((await api('GET', `/api/field/projects/${projectB}`, undefined, otherToken)).statusCode).toBe(404)
  })

  it('escritório define etapas e o mestre atualiza o avanço físico', async () => {
    const tpl = (await api('GET', '/api/stage-templates')).json()
    const res = await app.inject({ method: 'PUT', url: `/api/projects/${projectB}/stages`, headers: { authorization: `Bearer ${token}` }, payload: { stages: tpl } })
    expect(res.statusCode).toBe(200)
    expect((await app.inject({ method: 'PUT', url: `/api/projects/${projectB}/stages`, headers: { authorization: `Bearer ${mestre}` }, payload: { stages: tpl } })).statusCode).toBe(403)
    const stages = res.json().stages
    stageId = stages.find((s: any) => s.name === 'Fundação').id
    const up = await api('POST', `/api/field/stages/${stageId}/progress`, { progress: 100, note: 'Fundação concluída' }, mestre)
    expect(up.statusCode).toBe(200)
    const d = (await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)).json()
    expect(d.physicalPct).toBe(12) // peso 12 de 100
    expect(d.stageUpdates[0].fromProgress).toBe(0)
  })

  it('pedido de material vira pedido de compra e a entrega é conferida na obra', async () => {
    const r = await api('POST', `/api/field/projects/${projectB}/requests`, { items: [{ description: 'Cimento CP II 50kg', unit: 'sc', quantity: 80 }], urgent: true }, mestre)
    expect(r.statusCode).toBe(201)
    requestId = r.json().id
    const open = (await api('GET', '/api/material-requests?status=ABERTA')).json()
    expect(open.map((x: any) => x.id)).toContain(requestId)

    const s = (await api('POST', '/api/suppliers', { cnpj: fieldCnpj, name: 'Depósito Campo Ltda', status: 'HOMOLOGADO' })).json()
    const o = await api('POST', '/api/purchase-orders', { projectId: projectB, supplierId: s.id, requestId, items: [{ description: 'Cimento CP II 50kg', unit: 'sc', quantity: 80, unitPrice: 39 }] })
    expect(o.statusCode).toBe(201)
    orderId = o.json().id
    expect(o.json().request.id).toBe(requestId)
    await api('POST', `/api/purchase-orders/${orderId}/approve`)
    // a mesma solicitação não vira dois pedidos
    const again = await api('POST', '/api/purchase-orders', { projectId: projectB, supplierId: s.id, requestId, items: [{ description: 'Areia', quantity: 1, unitPrice: 1 }] })
    expect(again.statusCode).toBe(409)

    const d = (await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)).json()
    const delivery = d.deliveries.find((x: any) => x.id === orderId)
    expect(delivery.items[0].remainingQty).toBe(80)
    expect(d.requests.find((x: any) => x.id === requestId).status).toBe('EM_COMPRA')

    const rec = await api('POST', `/api/field/orders/${orderId}/receive`, { items: [{ orderItemId: delivery.items[0].id, quantity: 50 }] }, mestre)
    expect(rec.statusCode).toBe(201)
    const order = (await api('GET', `/api/purchase-orders/${orderId}`)).json()
    expect(order.items[0].onSiteQty).toBe(50)
    expect(order.receipts[0].receivedByName).toBe('Mestre Zé')
  })

  it('entrega com problema e ocorrência grave viram alerta; foto fica na obra', async () => {
    const d = (await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)).json()
    const item = d.deliveries.find((x: any) => x.id === orderId).items[0]
    const bad = await api('POST', `/api/field/orders/${orderId}/receive`, { items: [{ orderItemId: item.id, quantity: 25 }], problem: true, notes: '5 sacos rasgados' }, mestre)
    expect(bad.json().occurrenceId).toBeTruthy()

    const occ = await api('POST', `/api/field/projects/${projectB}/occurrences`, { type: 'SEGURANCA', severity: 'ALTA', title: 'Andaime sem guarda-corpo' }, mestre)
    expect(occ.statusCode).toBe(201)
    let alerts = (await api('GET', '/api/alerts')).json().filter((a: any) => a.type === 'OCORRENCIA')
    expect(alerts.some((a: any) => a.severity === 'CRITICO' && a.title.includes('Andaime'))).toBe(true)
    expect(alerts.some((a: any) => a.title.includes('com problema'))).toBe(true)

    const boundary = '----operaia' + rnd()
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="occurrenceId"\r\n\r\n${occ.json().id}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nAndaime do bloco B\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const ph = await app.inject({ method: 'POST', url: `/api/field/projects/${projectB}/photos`, headers: { authorization: `Bearer ${mestre}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
    expect(ph.statusCode).toBe(201)
    const after = (await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)).json()
    expect(after.occurrences.find((o: any) => o.id === occ.json().id).photos).toHaveLength(1)

    await api('POST', `/api/field/occurrences/${occ.json().id}/resolve`, { resolution: 'Guarda-corpo instalado' }, mestre)
    alerts = (await api('GET', '/api/alerts')).json().filter((a: any) => a.type === 'OCORRENCIA')
    expect(alerts.some((a: any) => a.title.includes('Andaime'))).toBe(false)
  })
})

describe('app de obra sem internet (fila do celular)', () => {
  let mestre = ''
  beforeAll(async () => {
    const [u] = await db.insert(users).values({ companyId: createdCompanies[0], name: 'Mestre Offline', email: `o${rnd()}@teste.com`, passwordHash: 'x', role: 'MESTRE' }).returning()
    mestre = app.jwt.sign({ sub: u.id, companyId: u.companyId, role: 'MESTRE', name: u.name })
  })
  const post = (url: string, payload: unknown, key?: string) =>
    app.inject({ method: 'POST', url, payload: payload as any, headers: { authorization: `Bearer ${mestre}`, ...(key && { 'idempotency-key': key }) } })

  it('reenvio com a mesma chave não duplica e guarda a hora em que aconteceu', async () => {
    const key = 'occ-' + randomBytes(8).toString('hex')
    const when = new Date(Date.now() - 3 * 3600_000).toISOString()
    const body = { type: 'CLIMA', severity: 'BAIXA', title: 'Chuva parou a obra (registrado sem sinal)', happenedAt: when }
    const a = await post(`/api/field/projects/${projectB}/occurrences`, body, key)
    const b = await post(`/api/field/projects/${projectB}/occurrences`, body, key)
    expect(a.statusCode).toBe(201)
    expect(b.statusCode).toBe(201)
    expect(b.json().id).toBe(a.json().id)
    expect(b.headers['idempotent-replay']).toBe('true')
    const d = (await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)).json()
    const mine = d.occurrences.filter((o: any) => o.title.includes('registrado sem sinal'))
    expect(mine).toHaveLength(1)
    expect(new Date(mine[0].createdAt).toISOString()).toBe(when)
    // data no futuro vira "agora"
    const fut = await post(`/api/field/projects/${projectB}/occurrences`, { ...body, title: 'Futuro', happenedAt: new Date(Date.now() + 86400_000).toISOString() })
    expect(new Date(fut.json().createdAt).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('avanço antigo da fila não sobrescreve um mais novo', async () => {
    const d = (await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)).json()
    const stage = d.stages.find((s: any) => s.name === 'Estrutura')
    const now = await post(`/api/field/stages/${stage.id}/progress`, { progress: 60 })
    expect(now.json().applied).toBe(true)
    const old = await post(`/api/field/stages/${stage.id}/progress`, { progress: 30, happenedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, 'stg-' + randomBytes(8).toString('hex'))
    expect(old.json().applied).toBe(false)
    expect(old.json().progress).toBe(60)
    const after = (await api('GET', `/api/field/projects/${projectB}`, undefined, mestre)).json()
    expect(after.stages.find((s: any) => s.id === stage.id).progress).toBe(60)
    expect(after.stageUpdates.some((u: any) => u.progress === 30)).toBe(true)
  })

  it('erro de validação não fica gravado na chave', async () => {
    const key = 'bad-' + randomBytes(8).toString('hex')
    const bad = await post(`/api/field/projects/${projectB}/occurrences`, { type: 'CLIMA', severity: 'BAIXA', title: 'x' }, key)
    expect(bad.statusCode).toBe(400)
    const ok = await post(`/api/field/projects/${projectB}/occurrences`, { type: 'CLIMA', severity: 'BAIXA', title: 'Agora com título' }, key)
    expect(ok.statusCode).toBe(201)
  })
})

describe('liberações por pessoa e "ver como"', () => {
  let finId = ''
  let fin = ''
  let mestreId = ''
  beforeAll(async () => {
    const [f, m] = await db
      .insert(users)
      .values([
        { companyId: createdCompanies[0], name: 'Fin Restrito', email: `f${rnd()}@teste.com`, passwordHash: 'x', role: 'FINANCEIRO' },
        { companyId: createdCompanies[0], name: 'Mestre Restrito', email: `r${rnd()}@teste.com`, passwordHash: 'x', role: 'MESTRE' },
      ])
      .returning()
    finId = f.id
    mestreId = m.id
    fin = app.jwt.sign({ sub: f.id, companyId: f.companyId, role: 'FINANCEIRO', name: f.name })
  })
  const patchUser = (id: string, payload: unknown, auth = token) => app.inject({ method: 'PATCH', url: `/api/users/${id}`, payload: payload as any, headers: { authorization: `Bearer ${auth}` } })

  it('padrão do perfil vem no /me e o administrador vê tudo', async () => {
    const meAdmin = (await api('GET', '/api/auth/me')).json()
    expect(meAdmin.permissions.admin).toBe(true)
    const meFin = (await api('GET', '/api/auth/me', undefined, fin)).json()
    expect(meFin.permissions.actions).toContain('aprovar_notas')
    expect(meFin.permissions.custom).toBe(false)
  })

  it('tirar uma tela bloqueia a API na hora, sem novo login', async () => {
    expect((await api('GET', '/api/payables', undefined, fin)).statusCode).toBe(200)
    const r = await patchUser(finId, { permissions: { screens: ['dashboard', 'notas', 'obras'], actions: [], projectIds: null } })
    expect(r.statusCode).toBe(200)
    expect(r.json().permissions.custom).toBe(true)
    expect((await api('GET', '/api/payables', undefined, fin)).statusCode).toBe(403)
    expect((await api('GET', '/api/reports', undefined, fin)).statusCode).toBe(403)
    expect((await api('GET', '/api/documents', undefined, fin)).statusCode).toBe(200)
    // sem a ação de aprovar notas
    const docs = (await api('GET', '/api/documents?status=RECEBIDO,EM_REVISAO', undefined, fin)).json()
    if (docs[0]) {
      const ap = await api('POST', `/api/documents/${docs[0].id}/approve`, { allocations: [{ projectId: projectA, category: 'MATERIAIS', amount: 1 }] }, fin)
      expect(ap.statusCode).toBe(403)
    }
    // volta ao padrão
    await patchUser(finId, { permissions: null })
    expect((await api('GET', '/api/payables', undefined, fin)).statusCode).toBe(200)
  })

  it('só pessoas do administrador; ninguém mexe nas próprias liberações', async () => {
    expect((await patchUser(finId, { permissions: null }, fin)).statusCode).toBe(403)
    expect((await patchUser(finId, { permissions: { screens: [], actions: [], projectIds: ['00000000-0000-4000-8000-000000000000'] } })).statusCode).toBe(400)
  })

  it('obras liberadas restringem o app de obra e a tela Obras', async () => {
    await patchUser(mestreId, { permissions: { screens: ['app_obra'], actions: [], projectIds: [projectA] } })
    const m = app.jwt.sign({ sub: mestreId, companyId: createdCompanies[0], role: 'MESTRE', name: 'Mestre Restrito' })
    const list = (await api('GET', '/api/field/projects', undefined, m)).json()
    expect(list.map((p: any) => p.id)).toEqual([projectA])
    expect((await api('GET', `/api/field/projects/${projectB}`, undefined, m)).statusCode).toBe(404)
    const occ = await app.inject({ method: 'POST', url: `/api/field/projects/${projectB}/occurrences`, payload: { type: 'OUTRO', severity: 'BAIXA', title: 'Obra errada' }, headers: { authorization: `Bearer ${m}` } })
    expect(occ.statusCode).toBe(404)
    expect((await api('GET', `/api/field/projects/${projectA}`, undefined, m)).statusCode).toBe(200)
  })

  it('"ver como" usa as liberações da pessoa e não grava nada', async () => {
    const r = await api('POST', `/api/users/${mestreId}/view-as`)
    expect(r.statusCode).toBe(200)
    const view = r.json().token as string
    const me2 = (await api('GET', '/api/auth/me', undefined, view)).json()
    expect(me2.user.id).toBe(mestreId)
    expect(me2.viewAs.byName).toBeTruthy()
    expect(me2.permissions.screens).toEqual(['app_obra'])
    expect((await api('GET', '/api/field/projects', undefined, view)).statusCode).toBe(200)
    expect((await api('GET', '/api/payables', undefined, view)).statusCode).toBe(403)
    const w = await app.inject({ method: 'POST', url: `/api/field/projects/${projectA}/occurrences`, payload: { type: 'OUTRO', severity: 'BAIXA', title: 'Não pode gravar' }, headers: { authorization: `Bearer ${view}` } })
    expect(w.statusCode).toBe(403)
    expect(w.json().code).toBe('SO_LEITURA')
    // quem não é administrador não usa "ver como"
    expect((await api('POST', `/api/users/${mestreId}/view-as`, undefined, fin)).statusCode).toBe(403)
  })
})

function postFile(url: string, content: Buffer | string, name: string, auth = token) {
  const boundary = '----operaia' + rnd()
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${auth}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
}

describe('importação de obras por planilha', () => {
  it('modelo .xlsx vem com as obras atuais e volta igual na prévia', async () => {
    const r = await api('GET', '/api/projects/import/template.xlsx')
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('spreadsheetml')
    const p = await postFile('/api/projects/import/preview', r.rawPayload, 'obras.xlsx')
    expect(p.statusCode).toBe(200)
    const prev = p.json()
    const t01 = prev.rows.find((x: any) => x.code === 'T-01')
    expect(t01.action).toBe('ATUALIZA')
    expect(t01.budgetTotal).toBe(10_000_00)
    expect(t01.budgets).toEqual([{ category: 'MATERIAIS', amount: 8_000_00 }])
  })

  it('CSV do Excel: prévia aponta erros por linha e não grava nada', async () => {
    const csv = [
      'Código;Nome da obra;Endereço;Situação;Início;Término;Materiais;Mão de obra;Orçamento total',
      'IMP-01;Casa Importada;Rua A, 10;Ativa;15/01/2026;30/06/2027;R$ 120.000,00;80.000,00;',
      'IMP-02;Loja Importada;;Pausada;;;;;R$ 45.000,00',
      'IMP-03;Sem orçamento;;Ativa;;;;;',
      'IMP-01;Repetida;;Ativa;;;;;1000',
      'IMP-04;Data ruim;;Talvez;32/13/2026;;;;5000',
      'IMP-05;Total menor;;Ativa;;;10.000,00;;5.000,00',
      'T-02;Galpão Beta Atualizado;Av. Nova, 1;Concluída;;;;;150000',
      ';;;;;;;;',
    ].join('\r\n')
    const r = await postFile('/api/projects/import/preview', csv, 'obras.csv')
    expect(r.statusCode).toBe(200)
    const { rows, summary } = r.json()
    expect(summary).toMatchObject({ total: 7, create: 2, update: 1, errors: 4 })
    const by = (c: string, n = 0) => rows.filter((x: any) => x.code === c)[n]
    expect(by('IMP-01')).toMatchObject({ action: 'NOVA', startDate: '2026-01-15', endDate: '2027-06-30', budgetTotal: 200_000_00 })
    expect(by('IMP-02')).toMatchObject({ status: 'PAUSADA', budgetTotal: 45_000_00, budgets: [] })
    expect(by('IMP-03').errors[0]).toMatch(/Sem orçamento/)
    expect(by('IMP-01', 1).errors[0]).toMatch(/repetido.*linha 2/)
    expect(by('IMP-04').errors.join(' ')).toMatch(/Situação.*Início/)
    expect(by('IMP-05').errors[0]).toMatch(/menor que a soma/)
    expect(by('T-02')).toMatchObject({ action: 'ATUALIZA', status: 'CONCLUIDA' })
    const list = (await api('GET', '/api/projects')).json()
    expect(list.some((p: any) => p.code === 'IMP-01')).toBe(false)
  })

  it('confirmação grava só as linhas sem erro, com auditoria', async () => {
    const csv = [
      'codigo,nome,situacao,materiais,servicos,total',
      'IMP-10,Obra Nova Dez,ativa,"1,500.00",500,',
      'T-02,Galpão Beta,em andamento,,,"120,000.00"',
      'IMP-11,,ativa,,,100',
    ].join('\n')
    const r = await postFile('/api/projects/import', csv, 'obras.csv')
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ created: 1, updated: 1, skipped: 1 })
    const list = (await api('GET', '/api/projects')).json()
    const nova = list.find((p: any) => p.code === 'IMP-10')
    expect(nova.budgetTotal).toBe(2_000_00)
    expect(list.find((p: any) => p.code === 'T-02').budgetTotal).toBe(120_000_00)
    const budgets = await db.select().from(projectBudgets).where(eq(projectBudgets.projectId, nova.id))
    expect(budgets.map((b) => [b.category, b.amount]).sort()).toEqual([
      ['MATERIAIS', 1_500_00],
      ['SERVICOS', 500_00],
    ])
  })

  it('exige a liberação de editar obras e respeita as obras liberadas', async () => {
    const [g] = await db
      .insert(users)
      .values({ companyId: createdCompanies[0], name: 'Gestor Imp', email: `g${rnd()}@teste.com`, passwordHash: 'x', role: 'GESTOR_OBRA', permissions: { projectIds: [projectA] } })
      .returning()
    const gt = app.jwt.sign({ sub: g.id, companyId: g.companyId, role: 'GESTOR_OBRA', name: g.name })
    const r = await postFile('/api/projects/import/preview', 'Código;Nome;Total\nT-02;Galpão;1000\nT-01;Residencial;1000', 'x.csv', gt)
    expect(r.statusCode).toBe(200)
    expect(r.json().rows[0].errors[0]).toMatch(/não está liberada/)
    expect(r.json().rows[1].action).toBe('ATUALIZA')
    const [f] = await db.insert(users).values({ companyId: createdCompanies[0], name: 'Fin Imp', email: `fi${rnd()}@teste.com`, passwordHash: 'x', role: 'FINANCEIRO' }).returning()
    const ft = app.jwt.sign({ sub: f.id, companyId: f.companyId, role: 'FINANCEIRO', name: f.name })
    expect((await postFile('/api/projects/import/preview', 'Código;Nome;Total\nX;Y;1', 'x.csv', ft)).statusCode).toBe(403)
    expect((await postFile('/api/projects/import/preview', 'a;b\n1;2', 'x.csv')).statusCode).toBe(400)
  })
})

describe('obras liberadas valem para o sistema todo', () => {
  let restrito = ''
  let docB = ''
  let docNovo = ''
  let payB = ''
  beforeAll(async () => {
    const [f] = await db
      .insert(users)
      .values({ companyId: createdCompanies[0], name: 'Fin Só A', email: `sa${rnd()}@teste.com`, passwordHash: 'x', role: 'FINANCEIRO', permissions: { projectIds: [projectA] } })
      .returning()
    restrito = app.jwt.sign({ sub: f.id, companyId: f.companyId, role: 'FINANCEIRO', name: f.name })
    // nota só da obra B, aprovada
    const up = (await upload(nfe(7001, { extraInfo: 'Obra: Galpão Beta', items: [{ description: 'TELHA METALICA', unit: 'UN', quantity: 10, unitPrice: 100 }], installments: [{ dueDate: '2030-03-10', amount: 1000 }] }))).json().results[0]
    docB = up.documentId
    const ap = await api('POST', `/api/documents/${docB}/approve`, { allocations: [{ projectId: projectB, category: 'MATERIAIS', amount: 1_000_00 }] })
    expect(ap.statusCode).toBe(200)
    payB = ap.json().payables[0].id
    // nota sem obra nenhuma (ainda não triada)
    docNovo = (await upload(nfe(7002, { extraInfo: '', items: [{ description: 'PREGO 18X27', unit: 'KG', quantity: 5, unitPrice: 20 }], installments: [] }))).json().results[0].documentId
  })

  it('lista de notas e contas a pagar escondem a obra não liberada', async () => {
    const docs = (await api('GET', '/api/documents', undefined, restrito)).json()
    const ids = docs.map((d: any) => d.id)
    expect(ids).not.toContain(docB)
    expect(ids).toContain(docNovo)
    expect((await api('GET', '/api/documents', undefined, token)).json().map((d: any) => d.id)).toContain(docB)
    const pays = (await api('GET', '/api/payables?status=ABERTO,PARCIAL,PAGO', undefined, restrito)).json()
    expect(pays.map((p: any) => p.id)).not.toContain(payB)
    expect(pays.length).toBeGreaterThan(0)
  })

  it('abrir, pagar ou apropriar fora das obras liberadas dá 404', async () => {
    expect((await api('GET', `/api/documents/${docB}`, undefined, restrito)).statusCode).toBe(404)
    expect((await api('GET', `/api/documents/${docB}/file`, undefined, restrito)).statusCode).toBe(404)
    expect((await api('POST', `/api/payables/${payB}/payments`, { amount: 100, paidAt: '2030-03-10' }, restrito)).statusCode).toBe(404)
    expect((await api('GET', `/api/documents?projectId=${projectB}`, undefined, restrito)).statusCode).toBe(404)
    const ap = await api('POST', `/api/documents/${docNovo}/approve`, { allocations: [{ projectId: projectB, category: 'MATERIAIS', amount: 100_00 }] }, restrito)
    expect(ap.statusCode).toBe(404)
    expect((await api('GET', `/api/documents/${docNovo}`, undefined, restrito)).statusCode).toBe(200)
  })

  it('visão geral, relatórios e lançamentos só somam as obras liberadas', async () => {
    const dash = (await api('GET', '/api/dashboard?from=2020-01-01&to=2035-12-31', undefined, restrito)).json()
    expect(dash.projects.map((p: any) => p.id)).toEqual([projectA])
    const all = (await api('GET', '/api/reports', undefined, token)).json()
    const mine = (await api('GET', '/api/reports', undefined, restrito)).json()
    expect(all.byProject.map((p: any) => p.projectId)).toContain(projectB)
    expect(mine.byProject.map((p: any) => p.projectId)).toEqual([projectA])
    expect(mine.total).toBe(all.byProject.find((p: any) => p.projectId === projectA).total)
    const csv = (await api('GET', '/api/exports/lancamentos.csv', undefined, restrito)).body
    expect(csv).toContain('T-01')
    expect(csv).not.toContain('T-02')
    const alerts = (await api('GET', '/api/alerts?status=ABERTO,RESOLVIDO,IGNORADO', undefined, restrito)).json()
    expect(alerts.every((a: any) => !a.projectId || a.projectId === projectA)).toBe(true)
  })
})

describe('estorno de pagamento', () => {
  let payableId = ''
  let amount = 0
  beforeAll(async () => {
    const up = (await upload(nfe(8001, { items: [{ description: 'CAL HIDRATADA', unit: 'SC', quantity: 10, unitPrice: 30 }], installments: [{ dueDate: '2030-04-10', amount: 300 }] }))).json().results[0]
    const ap = await api('POST', `/api/documents/${up.documentId}/approve`, { allocations: [{ projectId: projectA, category: 'MATERIAIS', amount: 300_00 }] })
    payableId = ap.json().payables[0].id
    amount = ap.json().payables[0].amount
  })

  it('estorna o pagamento, o título volta a ter o valor em aberto e o histórico guarda tudo', async () => {
    expect((await api('POST', `/api/payables/${payableId}/payments`, { amount: 100_00, paidAt: '2030-04-01', method: 'PIX' })).json().status).toBe('PARCIAL')
    expect((await api('POST', `/api/payables/${payableId}/payments`, { amount: 200_00, paidAt: '2030-04-02', method: 'Boleto' })).json().status).toBe('PAGO')
    const hist = (await api('GET', `/api/payables/${payableId}/payments`)).json()
    expect(hist).toHaveLength(2)
    const second = hist.find((p: any) => p.amount === 200_00)

    expect((await api('POST', `/api/payables/${payableId}/payments/${second.id}/reverse`, { reason: 'x' })).statusCode).toBe(400)
    const r = await api('POST', `/api/payables/${payableId}/payments/${second.id}/reverse`, { reason: 'Valor digitado errado' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ status: 'PARCIAL', paidAmount: 100_00, amount })
    // não estorna duas vezes
    expect((await api('POST', `/api/payables/${payableId}/payments/${second.id}/reverse`, { reason: 'De novo' })).json().code).toBe('JA_ESTORNADO')

    const hist2 = (await api('GET', `/api/payables/${payableId}/payments`)).json()
    const rev = hist2.find((p: any) => p.id === second.id)
    expect(rev.reversedAt).toBeTruthy()
    expect(rev.reverseReason).toBe('Valor digitado errado')
    expect(rev.reversedByName).toBe('Teste')

    // registra o valor certo depois do estorno
    expect((await api('POST', `/api/payables/${payableId}/payments`, { amount: 200_00, paidAt: '2030-04-03' })).json().status).toBe('PAGO')
    const first = hist2.find((p: any) => p.amount === 100_00)
    expect((await api('POST', `/api/payables/${payableId}/payments/${first.id}/reverse`, { reason: 'Pago no título errado' })).json().status).toBe('PARCIAL')

    const audit = (await api('GET', `/api/audit?entity=payable&entityId=${payableId}`)).json()
    expect(audit.filter((a: any) => a.action === 'payment_reversed')).toHaveLength(2)
  })

  it('exige a liberação de pagamentos', async () => {
    const [g] = await db.insert(users).values({ companyId: createdCompanies[0], name: 'Gestor Est', email: `ge${rnd()}@teste.com`, passwordHash: 'x', role: 'GESTOR_OBRA' }).returning()
    const gt = app.jwt.sign({ sub: g.id, companyId: g.companyId, role: 'GESTOR_OBRA', name: g.name })
    const hist = (await api('GET', `/api/payables/${payableId}/payments`)).json()
    const live = hist.find((p: any) => !p.reversedAt)
    expect((await api('POST', `/api/payables/${payableId}/payments/${live.id}/reverse`, { reason: 'Sem liberação' }, gt)).statusCode).toBe(403)
  })
})

describe('pacote do contador (ZIP do mês)', () => {
  it('traz os XML originais, o índice e respeita o período e as obras liberadas', async () => {
    const { unzipSync, strFromU8 } = await import('fflate')
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const r = await api('GET', `/api/exports/notas-contador.zip?from=${today.slice(0, 8)}01&to=${today}`)
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('application/zip')
    const files = unzipSync(new Uint8Array(r.rawPayload))
    const names = Object.keys(files)
    expect(names).toEqual(expect.arrayContaining(['notas.csv', 'lancamentos-por-obra.csv', 'LEIA-ME.txt']))
    const xmls = names.filter((n) => n.startsWith('XML/'))
    const count = Number(r.headers['x-notas'])
    expect(xmls.length).toBeGreaterThan(0)
    expect(xmls.length).toBeLessThanOrEqual(count)
    expect(strFromU8(files[xmls[0]])).toContain('<nfeProc')
    const csv = strFromU8(files['notas.csv'])
    expect(csv).toContain('Galpão Beta')
    expect(csv.trim().split('\r\n').length - 1).toBe(count)

    // período sem notas: pacote vazio, mas válido
    const empty = await api('GET', '/api/exports/notas-contador.zip?from=2001-01-01&to=2001-01-31')
    expect(empty.headers['x-notas']).toBe('0')
    expect(Object.keys(unzipSync(new Uint8Array(empty.rawPayload)))).toContain('LEIA-ME.txt')

    // pessoa só com a obra A não recebe a nota que é só da obra B
    const [f] = await db.insert(users).values({ companyId: createdCompanies[0], name: 'Fin Zip', email: `fz${rnd()}@teste.com`, passwordHash: 'x', role: 'FINANCEIRO', permissions: { projectIds: [projectA] } }).returning()
    const ft = app.jwt.sign({ sub: f.id, companyId: f.companyId, role: 'FINANCEIRO', name: f.name })
    const mine = await api('GET', `/api/exports/notas-contador.zip?from=${today.slice(0, 8)}01&to=${today}`, undefined, ft)
    expect(Number(mine.headers['x-notas'])).toBeLessThan(Number(r.headers['x-notas']))
    expect(strFromU8(unzipSync(new Uint8Array(mine.rawPayload))['notas.csv'])).not.toContain('NF-7001')
    expect((await api('GET', '/api/exports/notas-contador.zip?from=2026-02-01&to=2026-01-01')).statusCode).toBe(400)
  })
})

describe.skipIf(!hasMoto())('arquivos no S3 (servidor S3 de teste)', () => {
  let s3: Awaited<ReturnType<typeof startFakeS3>>
  beforeAll(async () => {
    s3 = await startFakeS3('operaia-api')
    setStorage(s3Storage({ endpoint: s3.endpoint, region: 'auto', bucket: 'operaia-api', accessKeyId: 'teste', secretAccessKey: 'segredo', pathStyle: true }))
  }, 20_000)
  afterAll(() => {
    setStorage(null)
    s3?.stop()
  })

  it('nota, foto da obra e pacote do contador funcionam com os arquivos no S3', async () => {
    const xml = nfe(9101, { items: [{ description: 'BRITA 1', unit: 'M3', quantity: 3, unitPrice: 100 }], installments: [] })
    const up = (await upload(xml)).json().results[0]
    expect(up.status).toBe('CRIADO')
    const [row] = await db.select({ filePath: documents.filePath }).from(documents).where(eq(documents.id, up.documentId))
    expect(row.filePath).toMatch(/^[0-9a-f-]{36}\/\d{4}-\d{2}\/[0-9a-f]{16}-nota\.xml$/)
    // o arquivo está no bucket, não no disco
    expect((await storage().get(row.filePath!))!.toString()).toBe(xml)
    expect(await diskStorage(STORAGE_DIR).exists(row.filePath!)).toBe(false)
    const file = await api('GET', `/api/documents/${up.documentId}/file`)
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toContain('application/xml')
    expect(file.body).toBe(xml)

    // foto da obra
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)])
    const boundary = '----operaia' + rnd()
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capa.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), jpg, Buffer.from(`\r\n--${boundary}--\r\n`)])
    const img = await app.inject({ method: 'POST', url: `/api/projects/${projectA}/image`, headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
    expect(img.statusCode).toBe(200)
    const media = await app.inject({ method: 'GET', url: img.json().imageUrl })
    expect(media.statusCode).toBe(200)
    expect(Buffer.from(media.rawPayload).equals(jpg)).toBe(true)

    // pacote do contador lê do S3
    const ap = await api('POST', `/api/documents/${up.documentId}/approve`, { allocations: [{ projectId: projectA, category: 'MATERIAIS', amount: 300_00 }], acknowledgeCritical: true })
    expect(ap.statusCode).toBe(200)
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const { unzipSync, strFromU8 } = await import('fflate')
    const zip = unzipSync(new Uint8Array((await api('GET', `/api/exports/notas-contador.zip?from=${today}&to=${today}`)).rawPayload))
    const mine = Object.keys(zip).find((n) => n.includes('NF-9101'))
    expect(mine && strFromU8(zip[mine])).toBe(xml)
  })
})
