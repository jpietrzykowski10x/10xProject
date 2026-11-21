import { MigrationInterface, QueryRunner } from 'typeorm';

// Values are spelled out literally: a migration must keep doing the same thing even when the code
// changes. They match ROLE_DEFINITIONS, which seeds the dev database.
export class SeedSuperAdminRole1795264077307 implements MigrationInterface {
  name = 'SeedSuperAdminRole1795264077307';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "role" ("id", "code", "name") VALUES
        ('ab11313f-1fa6-49eb-9770-227cf6a29d02', 'SUPER_ADMIN', 'Superadministrator')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "role" WHERE "id" = 'ab11313f-1fa6-49eb-9770-227cf6a29d02'`,
    );
  }
}
