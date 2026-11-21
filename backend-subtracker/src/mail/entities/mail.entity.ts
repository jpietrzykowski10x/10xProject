import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MailStatus, MailType } from '../mail.types.js';

export const MAIL_ERROR_MESSAGE_MAX_LENGTH = 500;

// Archive of outgoing mail. Holds no subject or body: those can carry sign-in links. It has no
// foreign key to `user` and outlives accounts: deleting an account replaces its address in
// `recipient` with ANONYMIZED_RECIPIENT and clears `error_message`, which can quote the address.
@Entity('mail')
export class Mail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 30 })
  type: MailType;

  // Indexed: account deletion anonymizes rows by it.
  @Index()
  @Column({ type: 'varchar', length: 254 })
  recipient: string;

  @Column({ type: 'varchar', length: 10 })
  status: MailStatus;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: MAIL_ERROR_MESSAGE_MAX_LENGTH,
    nullable: true,
  })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
