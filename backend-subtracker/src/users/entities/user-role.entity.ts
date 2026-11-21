import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { RoleCode, roleIdOf } from '../../shared/types/role-code.js';
import { Role } from './role.entity.js';
import { User } from './user.entity.js';

export const SINGLE_SUPER_ADMIN_INDEX = 'UQ_user_role_single_super_admin';

// At most one row holds the SUPER_ADMIN role, whoever writes it: grantRole checks first, this index
// stops a race past that check and a hand-written INSERT. A partial index TypeORM cannot describe,
// so it is marked `synchronize: false` below: neither migration:generate nor synchronize touches
// it. The AdminRolesAndAudit migration spells this statement out literally and RolesSeeder runs it
// on the synchronized dev database.
export const SINGLE_SUPER_ADMIN_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "${SINGLE_SUPER_ADMIN_INDEX}" ON "user_role" ("role_id") WHERE "role_id" = '${roleIdOf(RoleCode.SUPER_ADMIN)}'`;

// An explicit join entity rather than @ManyToMany, so columns can be added without a rebuild.
@Entity('user_role')
@Index(SINGLE_SUPER_ADMIN_INDEX, { synchronize: false })
export class UserRole {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  @Column({ name: 'granted_by', type: 'uuid', nullable: true })
  grantedBy: string | null;

  @ManyToOne(() => User, (user) => user.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role: Relation<Role>;
}
