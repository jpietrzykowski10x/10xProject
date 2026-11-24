import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';
import { failureCodeOf } from '../../shared/database/failure-code.js';
import { insertAdminAudit } from '../admin-audit-insert.js';
import { AdminAction, type AdminAuditEntry } from '../admin-audit.types.js';
import { AdminAudit } from '../entities/admin-audit.entity.js';

// Writes the trail of administrator actions (admin_audit). Only ids, never addresses.
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    @InjectRepository(AdminAudit)
    private readonly audit: Repository<AdminAudit>,
  ) {}

  // Inside the transaction of an action, so the row commits with the change or not at all.
  // Returns the id of the row.
  record(manager: EntityManager, entry: AdminAuditEntry): Promise<string> {
    return insertAdminAudit(manager, entry);
  }

  // A row outside the action's transaction (a search, a refusal rolled back with the action).
  // Never throws: the caller's answer does not depend on the trail, and a failure is logged as an
  // error with the database code only.
  async recordOutside(entry: AdminAuditEntry): Promise<void> {
    try {
      await insertAdminAudit(this.audit.manager, entry);
    } catch (error) {
      this.logger.error(
        `Admin audit ${entry.action} row not written for actor ${entry.actorId ?? 'cli'}` +
          ` target ${entry.targetId ?? 'none'} (code: ${failureCodeOf(error)})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // Records that the actor opened the target's data, before any of it is read. One statement that
  // writes the row only while the account exists, so an unknown id leaves no row. Returns false
  // for an unknown id.
  async recordView(actorId: string, targetId: string): Promise<boolean> {
    const rows = await this.audit.query<{ id: string }[]>(
      `INSERT INTO "admin_audit" ("actor_id", "target_id", "action")
       SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM "user" WHERE "id" = $2)
       RETURNING "id"`,
      [actorId, targetId, AdminAction.VIEW],
    );
    return rows.length > 0;
  }
}
