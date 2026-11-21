import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AdminAction } from '../admin-audit.types.js';

// Trail of administrator actions, read by the operator in SQL. Holds only account ids, no
// addresses, and has no foreign key to `user`: a row outlives the deletion of either account, so
// the account-deletion cascade leaves it alone. No indexes: no query of the application filters it.
@Entity('admin_audit')
export class AdminAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId: string;

  @Column({ type: 'varchar', length: 30 })
  action: AdminAction;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
