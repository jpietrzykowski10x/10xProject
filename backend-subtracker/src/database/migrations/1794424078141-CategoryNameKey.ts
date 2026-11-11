import { MigrationInterface, QueryRunner } from 'typeorm';

// Category names become unique by a key the application folds (toNameKey), not by lower() in the
// database, whose result depends on the database locale (with LC_CTYPE=C only ASCII is folded).
export class CategoryNameKey1794424078141 implements MigrationInterface {
  name = 'CategoryNameKey1794424078141';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Added nullable, filled, then made NOT NULL: the table already holds rows.
    await queryRunner.query(
      `ALTER TABLE "category" ADD "name_key" character varying(100)`,
    );
    // lower() gives the same key as toNameKey for the rows that can exist here: the nine default
    // categories (seeded by SeedDefaultCategories), whose only capitals are ASCII and whose Polish
    // letters are already lowercase, and own categories from before S-02 reached production, which
    // exist only in local databases.
    await queryRunner.query(`UPDATE "category" SET "name_key" = lower("name")`);
    await queryRunner.query(
      `ALTER TABLE "category" ALTER COLUMN "name_key" SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_category_owner_name"`);
    // Written by hand: TypeORM cannot describe an expression index (the entity marks it
    // `synchronize: false`). Spelled out literally, the same statement as
    // CATEGORY_OWNER_NAME_INDEX_SQL, which CategoriesSeeder runs on the synchronized dev database.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_category_owner_name_key" ON "category" (COALESCE("user_id", '00000000-0000-0000-0000-000000000000'), "name_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_category_owner_name_key"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_category_owner_name" ON "category" (COALESCE("user_id", '00000000-0000-0000-0000-000000000000'), lower("name"))`,
    );
    await queryRunner.query(`ALTER TABLE "category" DROP COLUMN "name_key"`);
  }
}
