import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthUserIdIndexes1793814039094 implements MigrationInterface {
  name = 'AddAuthUserIdIndexes1793814039094';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_c21d20e1af74597f4218801c73" ON "magic_link_token"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30e98e8746699fb9af235410af" ON "session"  ("user_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30e98e8746699fb9af235410af"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c21d20e1af74597f4218801c73"`,
    );
  }
}
