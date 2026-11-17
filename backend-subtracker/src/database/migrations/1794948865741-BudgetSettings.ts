import { MigrationInterface, QueryRunner } from 'typeorm';

export class BudgetSettings1794948865741 implements MigrationInterface {
  name = 'BudgetSettings1794948865741';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "budget_settings" ("user_id" uuid NOT NULL, "default_duplicate_threshold" smallint NOT NULL DEFAULT '3', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_97c72bca6c69be758dbff87987e" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ALTER COLUMN "duplicate_threshold" SET DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "budget_settings" ADD CONSTRAINT "FK_97c72bca6c69be758dbff87987e" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "budget_settings" DROP CONSTRAINT "FK_97c72bca6c69be758dbff87987e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ALTER COLUMN "duplicate_threshold" SET DEFAULT '2'`,
    );
    await queryRunner.query(`DROP TABLE "budget_settings"`);
  }
}
