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
import {
  BillingCycle,
  PaymentMethod,
  SUBSCRIPTION_NAME_MAX_LENGTH,
  SubscriptionStatus,
} from '../subscription.types.js';
import { Category } from './category.entity.js';

// node-pg returns numeric as a string and date as 'YYYY-MM-DD', so both stay strings here: no
// float rounding of money and no time-zone shift of calendar days.
@Entity('subscription')
// For the lifecycle job: pending cancellations and active subscriptions by billing date, trials by
// the end of the trial.
@Index('IDX_subscription_status_next_billing_date', [
  'status',
  'nextBillingDate',
])
@Index('IDX_subscription_status_trial_end_date', ['status', 'trialEndDate'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // Deleting an account deletes its subscriptions.
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  // Indexed: the foreign key check on deleting a category, and grouping or filtering by category
  // (S-04 totals, S-07 duplicates, S-08 limits) all look subscriptions up by category.
  @Index()
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => Category)
  @JoinColumn({ name: 'category_id' })
  category: Relation<Category>;

  @Column({ type: 'varchar', length: SUBSCRIPTION_NAME_MAX_LENGTH })
  name: string;

  // Price per billing cycle in PLN.
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: string;

  @Column({ name: 'billing_cycle', type: 'varchar', length: 16 })
  billingCycle: BillingCycle;

  @Column({ name: 'payment_method', type: 'varchar', length: 32 })
  paymentMethod: PaymentMethod;

  @Column({ type: 'varchar', length: 32 })
  status: SubscriptionStatus;

  @Column({ name: 'trial_end_date', type: 'date', nullable: true })
  trialEndDate: string | null;

  // The trial end date that the trial reminder went out (or is being sent) for. A reminder is due
  // again only when trial_end_date differs from it, so moving the end date re-arms the reminder.
  // Not part of the API response.
  @Column({ name: 'trial_reminder_sent_for', type: 'date', nullable: true })
  trialReminderSentFor: string | null;

  @Column({ name: 'next_billing_date', type: 'date' })
  nextBillingDate: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
