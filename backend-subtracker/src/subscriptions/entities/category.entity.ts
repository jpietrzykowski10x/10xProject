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

// name_key is longer than name: see the column below.
export const CATEGORY_NAME_KEY_MAX_LENGTH = CATEGORY_NAME_MAX_LENGTH * 2;

export const CATEGORY_OWNER_NAME_INDEX = 'UQ_category_owner_name_key';

// One name per owner, whatever its case; the defaults (user_id NULL) count as one owner. The case
// is folded by the application into name_key (toNameKey), not by lower() in the database, whose
// result depends on the database locale. An expression index TypeORM cannot describe, so it is
// marked `synchronize: false` below: neither migration:generate nor synchronize touches it. The
// CategoryNameKey migration spells this statement out literally and CategoriesSeeder runs it on
// the synchronized dev database. It replaced the index UQ_category_owner_name on lower(name).
export const CATEGORY_OWNER_NAME_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "${CATEGORY_OWNER_NAME_INDEX}" ON "category" (COALESCE("user_id", '00000000-0000-0000-0000-000000000000'), "name_key")`;

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

  // toNameKey(name), written with every insert. Twice the name's limit: lowercasing a Polish
  // letter never adds characters, but some Unicode letters do ("İ" becomes "i" + a combining dot).
  @Column({
    name: 'name_key',
    type: 'varchar',
    length: CATEGORY_NAME_KEY_MAX_LENGTH,
  })
  nameKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
