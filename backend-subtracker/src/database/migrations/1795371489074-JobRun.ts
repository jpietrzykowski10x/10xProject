import { MigrationInterface, QueryRunner } from 'typeorm';

export class JobRun1795371489074 implements MigrationInterface {
  name = 'JobRun1795371489074';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "job_run" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "job" character varying(40) NOT NULL, "trigger" character varying(10) NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE, "outcome" character varying(10), "counters" jsonb, CONSTRAINT "PK_96fe0b041b8bc157dcec25bd8ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_run_job_started_at" ON "job_run"  ("job", "started_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_job_run_job_started_at"`);
    await queryRunner.query(`DROP TABLE "job_run"`);
  }
}
