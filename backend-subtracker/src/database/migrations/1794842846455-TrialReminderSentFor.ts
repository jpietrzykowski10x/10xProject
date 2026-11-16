import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrialReminderSentFor1794842846455 implements MigrationInterface {
  name = 'TrialReminderSentFor1794842846455';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscription" ADD "trial_reminder_sent_for" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP COLUMN "trial_reminder_sent_for"`,
    );
  }
}
