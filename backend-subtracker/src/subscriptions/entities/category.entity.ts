import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { CATEGORY_NAME_MAX_LENGTH } from '../subscription.types.js';

export const CATEGORY_OWNER_NAME_INDEX = 'UQ_category_owner_name';

// One name per owner, whatever its case; the defaults (user_id NULL) count as one owner. An
// expression index TypeORM cannot describe, so it is marked `synchronize: false` below: neither
// migration:generate nor synchronize touches it. The SubscriptionsSchema migration spells this
// statement out literally and CategoriesSeeder runs it on the synchronized dev database.
export const CATEGORY_OWNER_NAME_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "${CATEGORY_OWNER_NAME_INDEX}" ON "category" (COALESCE("user_id", '00000000-0000-0000-0000-000000000000'), lower("name"))`;

// user_id NULL marks a default category, shared by every account.
@Entity('category')
@Index(CATEGORY_OWNER_NAME_INDEX, { synchronize: false })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User> | null;

  @Column({ type: 'varchar', length: CATEGORY_NAME_MAX_LENGTH })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
