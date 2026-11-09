import { MigrationInterface, QueryRunner } from 'typeorm';

// Values are spelled out literally: a migration must keep doing the same thing even when the code
// changes. They match ROLE_DEFINITIONS, which seeds the dev database.
export class SeedRoles1793732271790 implements MigrationInterface {
  name = 'SeedRoles1793732271790';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "role" ("id", "code", "name") VALUES
        ('c23edba1-52ef-4dd4-8608-3d95b16af950', 'USER', 'Użytkownik'),
        ('aa77833c-3a6d-43f7-8428-97aab95e25f2', 'ADMIN', 'Administrator')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "role" WHERE "id" IN ('c23edba1-52ef-4dd4-8608-3d95b16af950', 'aa77833c-3a6d-43f7-8428-97aab95e25f2')`,
    );
  }
}
