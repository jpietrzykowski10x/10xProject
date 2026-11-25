import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { Category } from './category.entity.js';

// The foreign key category_setting.category_id → category.id (migration CategorySetting). A
// category deleted between the category check and the write fails on it.
export const CATEGORY_SETTING_CATEGORY_FK = 'FK_228db5ea674f274f52ee203d326';

// A user's settings for one category, default or their own (S-07: the duplicate threshold; S-08
// adds the category limit). No row means the defaults, so nothing is seeded per account.
@Entity('category_setting')
export class CategorySetting {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  // Indexed on its own: it is not the first column of the primary key, and the foreign key check
  // on deleting a category looks settings up by it.
  @Index()
  @PrimaryColumn({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  // Deleting an account deletes its settings.
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  // NO ACTION, like subscription.category_id: deleting a category has to deal with its settings.
  @ManyToOne(() => Category)
  @JoinColumn({ name: 'category_id' })
  category: Relation<Category>;

  // Null follows the user's current default threshold, like a missing row (S-08: a row saved for
  // a limit alone must not freeze the threshold). A new own category and the S-07 backfill still
  // write a value, so own categories keep a copy of the default.
  @Column({ name: 'duplicate_threshold', type: 'smallint', nullable: true })
  duplicateThreshold: number | null;

  // The category's monthly limit (S-08) in PLN, compared with its monthly sum; null means no limit.
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
