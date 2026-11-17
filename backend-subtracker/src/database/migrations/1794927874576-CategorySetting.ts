import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategorySetting1794927874576 implements MigrationInterface {
  name = 'CategorySetting1794927874576';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "category_setting" ("user_id" uuid NOT NULL, "category_id" uuid NOT NULL, "duplicate_threshold" smallint NOT NULL DEFAULT '2', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_73df22cd233022f3ab4b5b70e0e" PRIMARY KEY ("user_id", "category_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_228db5ea674f274f52ee203d32" ON "category_setting"  ("category_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ADD CONSTRAINT "FK_d748756b171544f4dd49608cd20" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" ADD CONSTRAINT "FK_228db5ea674f274f52ee203d326" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "category_setting" DROP CONSTRAINT "FK_228db5ea674f274f52ee203d326"`,
    );
    await queryRunner.query(
      `ALTER TABLE "category_setting" DROP CONSTRAINT "FK_d748756b171544f4dd49608cd20"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_228db5ea674f274f52ee203d32"`,
    );
    await queryRunner.query(`DROP TABLE "category_setting"`);
  }
}
