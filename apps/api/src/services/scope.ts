/**
 * Obras liberadas para a pessoa (liberações do administrador).
 *
 * `scope` = lista de obras liberadas, ou null quando a pessoa vê todas.
 * - Custo apropriado (relatórios, lançamentos, gráficos): só as apropriações nas obras liberadas.
 * - Nota e título: aparecem se alguma apropriação é de obra liberada. Antes de apropriar, vale a obra
 *   do pedido de compra ou a obra sugerida; nota ainda sem obra nenhuma aparece para todos (precisa ser triada).
 * - Pedido, solicitação do mestre e alerta: pela obra deles.
 */
import { inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { db } from '../db/client.js'
import { allocations } from '../db/schema.js'
import { notFound } from './errors.js'

export type Scope = string[] | null | undefined

const list = (ids: string[]) => (ids.length ? sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `) : sql`NULL::uuid`)

/** Nota visível dentro das obras liberadas (docId = coluna ou expressão com o id da nota). */
export function docInScope(docId: AnyColumn | SQL, scope: Scope): SQL | undefined {
  if (!scope) return undefined
  const ids = list(scope)
  return sql`(
    EXISTS (SELECT 1 FROM allocations sa WHERE sa.document_id = ${docId} AND sa.project_id IN (${ids}))
    OR (
      NOT EXISTS (SELECT 1 FROM allocations sa WHERE sa.document_id = ${docId})
      AND COALESCE((
        SELECT COALESCE(spo.project_id, sd.suggested_project_id) IN (${ids})
        FROM fiscal_documents sd LEFT JOIN purchase_orders spo ON spo.id = sd.purchase_order_id
        WHERE sd.id = ${docId}
      ), true)
    )
  )`
}

/** Apropriação de custo em obra liberada. */
export const allocInScope = (scope: Scope) => (scope ? inArray(allocations.projectId, scope.length ? scope : ['00000000-0000-0000-0000-000000000000']) : undefined)

/** Coluna de obra (pedido, solicitação) dentro das obras liberadas. */
export const projectInScope = (col: AnyColumn, scope: Scope) => (scope ? inArray(col, scope.length ? scope : ['00000000-0000-0000-0000-000000000000']) : undefined)

/** Alerta: pela obra; sem obra, pela nota; sem nenhum dos dois (fornecedor, vencimentos gerais), visível. */
export function alertInScope(projectCol: AnyColumn, documentCol: AnyColumn, scope: Scope): SQL | undefined {
  if (!scope) return undefined
  return sql`(CASE WHEN ${projectCol} IS NOT NULL THEN ${projectCol} IN (${list(scope)}) WHEN ${documentCol} IS NOT NULL THEN ${docInScope(documentCol, scope)} ELSE true END)`
}

async function check(query: SQL, what: string) {
  const { rows } = await db.execute<{ ok: boolean }>(query)
  if (!rows[0]?.ok) throw notFound(what)
}

export async function assertDocument(id: string, scope: Scope) {
  if (scope) await check(sql`SELECT ${docInScope(sql`${id}::uuid`, scope)} AS ok`, 'Documento')
}
export async function assertPayable(id: string, scope: Scope) {
  if (scope) await check(sql`SELECT ${docInScope(sql`(SELECT document_id FROM payables WHERE id = ${id}::uuid)`, scope)} AS ok`, 'Título')
}
export async function assertProjectRow(table: 'purchase_orders' | 'material_requests' | 'alerts', id: string, scope: Scope, what: string) {
  if (!scope) return
  if (table === 'alerts') {
    await check(sql`SELECT ${alertInScope(sql.raw('a.project_id') as unknown as AnyColumn, sql.raw('a.document_id') as unknown as AnyColumn, scope)} AS ok FROM alerts a WHERE a.id = ${id}::uuid`, what)
    return
  }
  await check(sql`SELECT project_id IN (${list(scope)}) AS ok FROM ${sql.identifier(table)} WHERE id = ${id}::uuid`, what)
}
