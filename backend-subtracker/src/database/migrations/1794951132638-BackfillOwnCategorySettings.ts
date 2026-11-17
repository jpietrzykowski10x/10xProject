import { MigrationInterface, QueryRunner } from 'typeorm';

// S-07: a new own category gets a copy of the user's default duplicate threshold when it is
// created. Own categories that existed before S-07 get the same here, so a later change of the
// default does not move them either. 3 is spelled out literally (a migration must keep doing the
// same thing when the code changes): it is the default every account has at this point, since
// budget_settings is still empty. Default categories (user_id NULL) keep following the user's
// default and get no row. Idempotent: rows that already exist are left alone.
export class BackfillOwnCategorySettings1794951132638 implements MigrationInterface {
  name = 'BackfillOwnCategorySettings1794951132638';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "category_setting" ("user_id", "category_id", "duplicate_threshold")
        SELECT "user_id", "id", 3 FROM "category" WHERE "user_id" IS NOT NULL
        ON CONFLICT ("user_id", "category_id") DO NOTHING`,
    );
  }

  // No down: the copied rows cannot be told apart from thresholds a user saved, and removing them
  // only makes those categories follow the default again. Reverting the CategorySetting migration
  // drops the whole table anyway.
  public async down(): Promise<void> {}
}
