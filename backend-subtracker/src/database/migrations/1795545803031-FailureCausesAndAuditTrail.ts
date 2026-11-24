import { MigrationInterface, QueryRunner } from 'typeorm';

export class FailureCausesAndAuditTrail1795545803031 implements MigrationInterface {
  name = 'FailureCausesAndAuditTrail1795545803031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admin_audit" ADD "details" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "job_run" ADD "failure" character varying(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_audit" ALTER COLUMN "actor_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_audit" ALTER COLUMN "target_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin_audit" ALTER COLUMN "target_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_audit" ALTER COLUMN "actor_id" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "job_run" DROP COLUMN "failure"`);
    await queryRunner.query(`ALTER TABLE "admin_audit" DROP COLUMN "details"`);
  }
}
