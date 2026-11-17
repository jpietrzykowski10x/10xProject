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
import { DEFAULT_DUPLICATE_THRESHOLD } from '../duplicate-warning.js';
import { Category } from './category.entity.js';

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

  @Column({
    name: 'duplicate_threshold',
    type: 'smallint',
    default: DEFAULT_DUPLICATE_THRESHOLD,
  })
  duplicateThreshold: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
