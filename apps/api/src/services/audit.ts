import type { Tx } from '../db/client.js'
import { auditLogs } from '../db/schema.js'

export async function audit(
  tx: Tx,
  entry: { companyId: string; userId?: string | null; entity: string; entityId: string; action: string; data?: unknown },
) {
  await tx.insert(auditLogs).values({
    companyId: entry.companyId,
    userId: entry.userId ?? null,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    data: (entry.data ?? null) as any,
  })
}
