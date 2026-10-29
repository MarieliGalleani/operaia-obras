/** Apaga o schema inteiro. Somente para desenvolvimento. */
import { pool } from './client.js'

if (process.env.NODE_ENV === 'production') {
  console.error('db:reset bloqueado em produção')
  process.exit(1)
}
await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;')
console.log('✔ banco limpo')
await pool.end()
