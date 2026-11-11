import { MigrationInterface, QueryRunner } from 'typeorm';

// Values are spelled out literally: a migration must keep doing the same thing even when the code
// changes. They match DEFAULT_CATEGORIES, which seeds the dev database. user_id NULL marks a
// default category.
export class SeedDefaultCategories1794406400550 implements MigrationInterface {
  name = 'SeedDefaultCategories1794406400550';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "category" ("id", "user_id", "name") VALUES
        ('4c51fa28-9ec4-492c-a0bc-9d96923ed894', NULL, 'Streaming'),
        ('a518aea0-884a-45b7-b1c7-cf64bcfb319c', NULL, 'Gry'),
        ('976831a8-723d-4967-b7a4-d5c34e2e00d7', NULL, 'Oprogramowanie i narzędzia'),
        ('26999174-d669-410b-9273-3823c53c86a5', NULL, 'Chmura i dane'),
        ('a4f79d55-2a61-46ca-831e-0a4f6f2bba95', NULL, 'Edukacja'),
        ('531b18f7-458d-49a7-a4f1-a98625cca728', NULL, 'Zdrowie i sport'),
        ('b62388d1-b508-41ae-aa73-3db22a63e12c', NULL, 'Prasa i książki'),
        ('f69cf33d-f070-4c75-83ed-50bb0d6bd029', NULL, 'Dom i usługi'),
        ('8312d1ba-9f14-4fe2-b611-ebd2538c2721', NULL, 'Inne')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "category" WHERE "id" IN ('4c51fa28-9ec4-492c-a0bc-9d96923ed894','a518aea0-884a-45b7-b1c7-cf64bcfb319c', '976831a8-723d-4967-b7a4-d5c34e2e00d7', '26999174-d669-410b-9273-3823c53c86a5', 'a4f79d55-2a61-46ca-831e-0a4f6f2bba95', '531b18f7-458d-49a7-a4f1-a98625cca728', 'b62388d1-b508-41ae-aa73-3db22a63e12c', 'f69cf33d-f070-4c75-83ed-50bb0d6bd029', '8312d1ba-9f14-4fe2-b611-ebd2538c2721')`,
    );
  }
}
