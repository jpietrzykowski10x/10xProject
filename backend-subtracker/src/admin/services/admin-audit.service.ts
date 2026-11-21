import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';
import { AdminAction } from '../admin-audit.types.js';
import { AdminAudit } from '../entities/admin-audit.entity.js';

// Writes the trail of administrator actions (admin_audit). Only ids, never addresses.
@Injectable()
export class AdminAuditService {
  constructor(
    @InjectRepository(AdminAudit)
    private readonly audit: Repository<AdminAudit>,
  ) {}

  // Inside the transaction of an action, so the row commits with the change or not at all.
  async record(
    manager: EntityManager,
    actorId: string,
    targetId: string,
    action: AdminAction,
  ): Promise<void> {
    await manager
      .getRepository(AdminAudit)
      .insert({ actorId, targetId, action });
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
