import type { EntityManager } from 'typeorm';
import type { AdminAuditEntry } from './admin-audit.types.js';
import { AdminAudit } from './entities/admin-audit.entity.js';

// The one place that writes an admin_audit row, inside the transaction of the caller's manager, so
// the row commits with the change or not at all. A plain function, not a provider: the auth module
// (account deletion) cannot inject AdminAuditService without a module cycle, and the role scripts
// do not boot Nest. Returns the id of the row.
export async function insertAdminAudit(
  manager: EntityManager,
  entry: AdminAuditEntry,
): Promise<string> {
  const result = await manager.getRepository(AdminAudit).insert({
    actorId: entry.actorId,
    targetId: entry.targetId,
    action: entry.action,
    details: 'details' in entry ? entry.details : null,
  });
  const [{ id }] = result.identifiers as { id: string }[];
  return id;
}
