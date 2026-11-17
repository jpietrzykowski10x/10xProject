// One-off for the local dev database (2026-11-17, S-07): does what the BackfillOwnCategorySettings
// migration does on subtracker-db, because synchronize creates tables but never inserts data. Gives
// every own category without a category_setting row the threshold 3. Idempotent.
// Run from backend-subtracker/: node --env-file=.env ../dev-local/backfill-own-category-settings.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { assertLocalDev } from './local-only.mjs';

assertLocalDev();
const require = createRequire(join(process.cwd(), 'package.json'));
const { Client } = require('pg');
const db = new Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DATABASE_DEV });
await db.connect();
const { rowCount } = await db.query(
  `INSERT INTO "category_setting" ("user_id", "category_id", "duplicate_threshold")
    SELECT "user_id", "id", 3 FROM "category" WHERE "user_id" IS NOT NULL
    ON CONFLICT ("user_id", "category_id") DO NOTHING`,
);
console.log(`${process.env.POSTGRES_DATABASE_DEV}: category_setting rows added for ${rowCount} own categories`);
await db.end();
