import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AdminAuditDetails } from '../admin-audit.types.js';
import { AdminAction } from '../admin-audit.types.js';

// Trail of administrator actions, account deletions and role changes, read by the operator in
// SQL. Holds only account ids and context that is not personal data, no addresses, and has no
// foreign key to `user`: a row outlives the deletion of either account, so the account-deletion
// cascade leaves it alone. No indexes: no query of the application filters it.
@Entity('admin_audit')
export class AdminAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Null for a role script (the CLI has no account).
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  // Null for an action without a single target (a search).
  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', length: 30 })
  action: AdminAction;

  // Per action, see AdminAuditEntry; null when the action has none.
  @Column({ type: 'jsonb', nullable: true })
  details: AdminAuditDetails | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
