import { MigrationInterface, QueryRunner } from 'typeorm';

export class BudgetLimits1794952897771 implements MigrationInterface {
  name = 'BudgetLimits1794952897771';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "budget_settings" ADD "monthly_limit" numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ADD "monthly_limit" numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ALTER COLUMN "duplicate_threshold" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ALTER COLUMN "duplicate_threshold" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A row without a threshold was saved only for a limit; without the row the category follows
    // the default as before, and NOT NULL can come back.
    await queryRunner.query(
      `DELETE FROM "category_setting" WHERE "duplicate_threshold" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ALTER COLUMN "duplicate_threshold" SET DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ALTER COLUMN "duplicate_threshold" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" DROP COLUMN "monthly_limit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "budget_settings" DROP COLUMN "monthly_limit"`,
    );
  }
}
