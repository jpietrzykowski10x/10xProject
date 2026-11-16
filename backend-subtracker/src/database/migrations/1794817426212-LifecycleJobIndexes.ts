import { MigrationInterface, QueryRunner } from 'typeorm';

export class LifecycleJobIndexes1794817426212 implements MigrationInterface {
  name = 'LifecycleJobIndexes1794817426212';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_magic_link_token_expires_at" ON "magic_link_token"  ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_session_expires_at" ON "session"  ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_session_revoked_at" ON "session"  ("revoked_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_status_trial_end_date" ON "subscription"  ("status", "trial_end_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_status_next_billing_date" ON "subscription"  ("status", "next_billing_date") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_status_next_billing_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_subscription_status_trial_end_date"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_session_revoked_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_session_expires_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_magic_link_token_expires_at"`,
    );
  }
}
