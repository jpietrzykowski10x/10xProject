import {
  Column,
  type EntityManager,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { DEFAULT_DUPLICATE_THRESHOLD } from '../duplicate-warning.js';

// A user's budget settings, one row per account, a typed column per setting (S-07: the default
// duplicate threshold; S-08: the overall monthly limit). Account preferences that are not about the
// budget (e.g. a theme) belong to the users module, not here. No row means the defaults, so
// nothing is seeded per account.
@Entity('budget_settings')
export class BudgetSettings {
  // The primary key, so it needs no index of its own.
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  // Deleting an account deletes its settings. ManyToOne, not OneToOne: the primary key already
  // keeps one row per user, and OneToOne would add a second unique constraint on the same column.
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  // Given to a category without a stored threshold, and copied to a new own category.
  @Column({
    name: 'default_duplicate_threshold',
    type: 'smallint',
    default: DEFAULT_DUPLICATE_THRESHOLD,
  })
  defaultDuplicateThreshold: number;

  // The overall monthly limit (S-08) in PLN, compared with the monthly total; null means no limit.
  @Column({
    name: 'monthly_limit',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  monthlyLimit: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

// The default duplicate threshold of a settings row: the stored one, else DEFAULT_DUPLICATE_THRESHOLD
// (no row means the defaults).
export function defaultThresholdOf(
  settings:
    Pick<BudgetSettings, 'defaultDuplicateThreshold'> | null | undefined,
): number {
  return settings?.defaultDuplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
}

// The user's current default duplicate threshold: the stored one, else DEFAULT_DUPLICATE_THRESHOLD.
// Takes a manager so it can read inside a transaction.
export async function defaultDuplicateThresholdOf(
  manager: EntityManager,
  userId: string,
): Promise<number> {
  const settings = await manager.findOne(BudgetSettings, {
    select: { userId: true, defaultDuplicateThreshold: true },
    where: { userId },
  });
  return defaultThresholdOf(settings);
}
