import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionsSchema1794406389791 implements MigrationInterface {
  name = 'SubscriptionsSchema1794406389791';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "category" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid, "name" character varying(50) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9c4e4a89e3674fc9f382d733f03" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6562e564389d0600e6e243d960" ON "category"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "subscription" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "category_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "amount" numeric(10,2) NOT NULL, "billing_cycle" character varying(16) NOT NULL, "payment_method" character varying(32) NOT NULL, "status" character varying(32) NOT NULL, "trial_end_date" date, "next_billing_date" date NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8c3e00ebd02103caa1174cd5d9d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_940d49a105d50bbd616be54001" ON "subscription"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7ddc1213ce93c60338e6da254" ON "subscription"  ("category_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "category" ADD CONSTRAINT "FK_6562e564389d0600e6e243d9604" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription" ADD CONSTRAINT "FK_940d49a105d50bbd616be540013" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription" ADD CONSTRAINT "FK_e7ddc1213ce93c60338e6da254d" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // Written by hand: TypeORM cannot describe an expression index (the entity marks it
    // `synchronize: false`). Spelled out literally, the same statement as
    // CATEGORY_OWNER_NAME_INDEX_SQL, which CategoriesSeeder runs on the synchronized dev database.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_category_owner_name" ON "category" (COALESCE("user_id", '00000000-0000-0000-0000-000000000000'), lower("name"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_category_owner_name"`);
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP CONSTRAINT "FK_e7ddc1213ce93c60338e6da254d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP CONSTRAINT "FK_940d49a105d50bbd616be540013"`,
    );
    await queryRunner.query(
      `ALTER TABLE "category" DROP CONSTRAINT "FK_6562e564389d0600e6e243d9604"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e7ddc1213ce93c60338e6da254"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_940d49a105d50bbd616be54001"`,
    );
    await queryRunner.query(`DROP TABLE "subscription"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6562e564389d0600e6e243d960"`,
    );
    await queryRunner.query(`DROP TABLE "category"`);
  }
}
