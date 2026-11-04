import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { UserRole } from './user-role.entity.js';

export const EMAIL_MAX_LENGTH = 254;

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Always stored through normalizeEmail().
  @Column({ type: 'varchar', length: EMAIL_MAX_LENGTH, unique: true })
  email: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: 'consents_accepted_at', type: 'timestamptz' })
  consentsAcceptedAt: Date;

  @Column({ name: 'privacy_policy_version', type: 'varchar', length: 20 })
  privacyPolicyVersion: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles: Relation<UserRole[]>;
}
