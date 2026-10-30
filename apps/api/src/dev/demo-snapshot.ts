/**
 * Gera um retrato (somente leitura) das respostas da API para a versão de demonstração do front.
 * Uso: pnpm --filter @operaia-obras/api demo:snapshot  → apps/web/demo/demo-data.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildApp } from '../app.js'
import { pool } from '../db/client.js'

const app = await buildApp()
const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@alpha.com.br', password: 'operaia123' } })
const token = login.json().token as string
const data: Record<string, unknown> = {}

async function grab(url: string) {
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
  if (res.statusCode !== 200) throw new Error(`${url} → ${res.statusCode}`)
  data[url] = res.json()
  return res.json()
}

// períodos idênticos aos do seletor do front (datas como texto, sem fuso)
const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
const monthRange = (offset: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(last)}` }
}
const periods = [0, 1, 2, 3, 4, 5].map(monthRange)
periods.push({ from: monthRange(2).from, to: monthRange(0).to })
periods.push({ from: monthRange(5).from, to: monthRange(0).to })

await grab('/api/auth/me')
for (const p of periods) {
  await grab(`/api/dashboard?from=${p.from}&to=${p.to}`)
  await grab(`/api/reports?from=${p.from}&to=${p.to}`)
}
const projects = (await grab('/api/projects')) as { id: string }[]
for (const p of projects) await grab(`/api/projects/${p.id}`)

const docStatuses = ['RECEBIDO,EM_REVISAO', 'APROVADO', 'REJEITADO,CANCELADO']
for (const s of docStatuses) await grab(`/api/documents?status=${s}`)
const allDocs = (await grab('/api/documents?')) as { id: string }[]
for (const d of allDocs) await grab(`/api/documents/${d.id}`)

for (const s of ['ABERTO,PARCIAL', 'PAGO', 'ABERTO,PARCIAL,PAGO,CANCELADO']) {
  await grab(`/api/payables?status=${s}`)
  for (const p of projects) await grab(`/api/payables?status=${s}&projectId=${p.id}`)
}
const sups = (await grab('/api/suppliers?')) as { id: string }[]
for (const s of sups) await grab(`/api/suppliers/${s.id}/prices`)
await grab('/api/alerts?status=ABERTO')
await grab('/api/alerts?status=RESOLVIDO,IGNORADO')
await grab('/api/mail-inbox')
await grab('/api/users')
data['/api/integrations'] = { apiKey: 'oo_demo_chave_ficticia_0000', nfeEndpoint: '/api/integrations/nfe' }

const out = new URL('../../../web/demo/', import.meta.url)
mkdirSync(out, { recursive: true })
writeFileSync(new URL('demo-data.json', out), JSON.stringify({ generatedAt: new Date().toISOString(), responses: data }))
console.log(`✔ ${Object.keys(data).length} respostas em apps/web/demo/demo-data.json`)
await app.close()
await pool.end()
