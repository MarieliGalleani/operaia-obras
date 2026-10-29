/**
 * Operação do OperaIA Obras (uso pela equipe OperaIA, na VPS).
 *
 *   node dist/cli/admin.js criar-construtora --nome "Construtora X" --cnpj 12.345.678/0001-90 \
 *        --admin-nome "Fulana" --admin-email fulana@construtora.com.br
 *   node dist/cli/admin.js criar-usuario --cnpj 12345678000190 --nome "Ciclano" --email c@x.com --perfil FINANCEIRO
 *   node dist/cli/admin.js resetar-senha --email fulana@construtora.com.br
 *   node dist/cli/admin.js listar
 *
 * Em desenvolvimento: pnpm --filter @operaia-obras/api admin <comando> ...
 */
import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { pool, db } from '../db/client.js'
import { companies } from '../db/schema.js'
import { formatCnpj, onlyDigits } from '../domain/cnpj.js'
import { createCompany, createUser, resetPassword, type Role } from '../services/accounts.js'

const [cmd, ...rest] = process.argv.slice(2)
const args: Record<string, string> = {}
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1]
const need = (k: string) => {
  if (!args[k]) throw new Error(`Faltou --${k}`)
  return args[k]
}

async function main() {
  switch (cmd) {
    case 'criar-construtora': {
      const c = await createCompany({ name: need('nome'), cnpj: need('cnpj') })
      const { user, password } = await createUser({ companyId: c.id, name: need('admin-nome'), email: need('admin-email'), role: 'ADMIN' })
      console.log(`\n✔ Construtora criada: ${c.name} (${formatCnpj(c.cnpj)})`)
      console.log(`  Admin: ${user.email}`)
      console.log(`  Senha provisória: ${password}`)
      console.log(`  Chave de integração (n8n): ${c.apiKey}`)
      console.log('\n  Envie a senha por um canal separado e peça para trocar no primeiro acesso (menu do avatar → Trocar senha).')
      break
    }
    case 'criar-usuario': {
      const c = await db.query.companies.findFirst({ where: eq(companies.cnpj, onlyDigits(need('cnpj'))) })
      if (!c) throw new Error('Construtora não encontrada para esse CNPJ')
      const role = (args.perfil ?? 'FINANCEIRO').toUpperCase() as Role
      if (!['ADMIN', 'FINANCEIRO', 'GESTOR_OBRA'].includes(role)) throw new Error('--perfil deve ser ADMIN, FINANCEIRO ou GESTOR_OBRA')
      const { user, password } = await createUser({ companyId: c.id, name: need('nome'), email: need('email'), role })
      console.log(`✔ ${user.email} (${role}) — senha provisória: ${password}`)
      break
    }
    case 'resetar-senha': {
      const pw = await resetPassword(need('email'))
      console.log(`✔ Nova senha provisória: ${pw}`)
      break
    }
    case 'listar': {
      const rows = await db.execute(sql`
        SELECT c.name, c.cnpj, c.created_at,
          (SELECT count(*) FROM users u WHERE u.company_id = c.id) AS usuarios,
          (SELECT count(*) FROM fiscal_documents d WHERE d.company_id = c.id) AS notas,
          (SELECT max(d.created_at) FROM fiscal_documents d WHERE d.company_id = c.id) AS ultima_nota
        FROM companies c ORDER BY c.created_at`)
      console.table(rows.rows.map((r: any) => ({ construtora: r.name, cnpj: formatCnpj(r.cnpj), usuarios: Number(r.usuarios), notas: Number(r.notas), ultima_nota: r.ultima_nota ? new Date(r.ultima_nota).toLocaleString('pt-BR') : '—' })))
      break
    }
    default:
      console.log('Comandos: criar-construtora | criar-usuario | resetar-senha | listar (veja o topo de src/cli/admin.ts)')
  }
}

try {
  await main()
} catch (e) {
  console.error(`✖ ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
