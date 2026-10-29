/** Construtoras e usuários: usado pela API (admin da construtora) e pela CLI de operação. */
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { companies, users } from '../db/schema.js'
import { formatCnpj, isValidCnpj, onlyDigits } from '../domain/cnpj.js'
import { audit } from './audit.js'
import { badRequest, conflict } from './errors.js'

export type Role = 'ADMIN' | 'FINANCEIRO' | 'GESTOR_OBRA'

/** Senha provisória legível (sem caracteres ambíguos), para enviar por canal seguro. */
export function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(12)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function validatePassword(pw: string) {
  if (pw.length < 10) throw badRequest('SENHA_FRACA', 'A senha precisa ter pelo menos 10 caracteres.')
}

export async function createCompany(input: { name: string; cnpj: string }) {
  const cnpj = onlyDigits(input.cnpj)
  if (!isValidCnpj(cnpj)) throw badRequest('CNPJ_INVALIDO', `CNPJ inválido: ${input.cnpj}`)
  const exists = await db.query.companies.findFirst({ where: eq(companies.cnpj, cnpj) })
  if (exists) throw conflict('JA_EXISTE', `Já existe construtora com CNPJ ${formatCnpj(cnpj)}.`)
  const [c] = await db.insert(companies).values({ name: input.name, cnpj, apiKey: `oo_${randomBytes(24).toString('hex')}` }).returning()
  await audit(db, { companyId: c.id, entity: 'company', entityId: c.id, action: 'created', data: { name: c.name } })
  return c
}

export async function createUser(input: { companyId: string; name: string; email: string; role: Role; password?: string; createdBy?: string }) {
  const email = input.email.trim().toLowerCase()
  const exists = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (exists) throw conflict('EMAIL_EM_USO', `O e-mail ${email} já tem acesso.`)
  const password = input.password ?? temporaryPassword()
  validatePassword(password)
  const [u] = await db
    .insert(users)
    .values({ companyId: input.companyId, name: input.name, email, role: input.role, passwordHash: await bcrypt.hash(password, 10) })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role })
  await audit(db, { companyId: input.companyId, userId: input.createdBy, entity: 'user', entityId: u.id, action: 'created', data: { email, role: input.role } })
  return { user: u, password }
}

export async function changePassword(userId: string, current: string, next: string) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw badRequest('SENHA_ATUAL', 'A senha atual não confere.')
  validatePassword(next)
  await db.update(users).set({ passwordHash: await bcrypt.hash(next, 10) }).where(eq(users.id, userId))
  await audit(db, { companyId: u.companyId, userId, entity: 'user', entityId: userId, action: 'password_changed' })
}

export async function resetPassword(email: string) {
  const u = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) })
  if (!u) throw badRequest('NAO_ENCONTRADO', `Usuário ${email} não encontrado.`)
  const password = temporaryPassword()
  await db.update(users).set({ passwordHash: await bcrypt.hash(password, 10) }).where(eq(users.id, u.id))
  await audit(db, { companyId: u.companyId, entity: 'user', entityId: u.id, action: 'password_reset' })
  return password
}
