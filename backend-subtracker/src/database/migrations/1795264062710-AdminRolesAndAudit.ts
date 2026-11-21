import { MigrationInterface, QueryRunner } from 'typeorm';

// S-09: the administrator's audit table (account ids without foreign keys, so a row outlives both
// accounts) and the index that allows at most one superadmin.
export class AdminRolesAndAudit1795264062710 implements MigrationInterface {
  name = 'AdminRolesAndAudit1795264062710';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_audit" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "actor_id" uuid NOT NULL, "target_id" uuid NOT NULL, "action" character varying(30) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5ad48a4d9d16397ef37e28bb0be" PRIMARY KEY ("id"))`,
    );
    // Written by hand: TypeORM cannot describe a partial index (the entity marks it
    // `synchronize: false`). Spelled out literally, the same statement as
    // SINGLE_SUPER_ADMIN_INDEX_SQL, which RolesSeeder runs on the synchronized dev database. The id
    // is the SUPER_ADMIN role's, inserted by the SeedSuperAdminRole migration.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_role_single_super_admin" ON "user_role" ("role_id") WHERE "role_id" = 'ab11313f-1fa6-49eb-9770-227cf6a29d02'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_user_role_single_super_admin"`,
    );
    await queryRunner.query(`DROP TABLE "admin_audit"`);
  }
}
