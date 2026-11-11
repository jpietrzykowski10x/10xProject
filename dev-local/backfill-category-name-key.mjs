// One-off for the local dev database (2026-11-11, S-02, already applied): adds and fills category.name_key the
// way the CategoryNameKey migration does on subtracker-db, so synchronize does not try to add a
// NOT NULL column to a table that already has rows. The old/new unique index is handled by
// CategoriesSeeder on the next app start. Idempotent.
// Run from backend-subtracker/: node --env-file=.env ../dev-local/backfill-category-name-key.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { assertLocalDev } from './local-only.mjs';

assertLocalDev();
const require = createRequire(join(process.cwd(), 'package.json'));
const { Client } = require('pg');
const db = new Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DATABASE_DEV });
await db.connect();
await db.query('BEGIN');
await db.query(`ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "name_key" character varying(100)`);
const { rowCount } = await db.query(`UPDATE "category" SET "name_key" = lower("name") WHERE "name_key" IS NULL`);
await db.query(`ALTER TABLE "category" ALTER COLUMN "name_key" SET NOT NULL`);
await db.query('COMMIT');
console.log(`${process.env.POSTGRES_DATABASE_DEV}: name_key filled for ${rowCount} rows`);
await db.end();
