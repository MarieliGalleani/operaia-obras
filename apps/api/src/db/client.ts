import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle(pool, { schema })
export type DB = typeof db
/** Tipo aceito tanto por `db` quanto por uma transação */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB
