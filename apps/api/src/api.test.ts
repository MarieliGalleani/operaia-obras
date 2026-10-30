/**
 * Teste de ponta a ponta da API contra o PostgreSQL de desenvolvimento.
 * Cria duas construtoras próprias (não depende do seed) e apaga tudo no final.
 */
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { db, pool } from './db/client.js'
import { companies, projectBudgets, projects, users } from './db/schema.js'
import { cnpjWithDigits } from './domain/cnpj.js'
import { buildNfeXml } from './dev/nfe-builder.js'

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
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha123' } })
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
