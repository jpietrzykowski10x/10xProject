// One-off (2026-11-11): widen category.name_key to varchar(100) on subtracker-db-dev,
// matching the CategoryNameKey migration. Run from backend-subtracker/:
//   node --env-file=.env ../dev-local/widen-category-name-key.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { assertLocalDev } from './local-only.mjs';

assertLocalDev();
const { Client } = createRequire(join(process.cwd(), 'package.json'))('pg');
const db = new Client({
  host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE_DEV,
});
await db.connect();
await db.query('ALTER TABLE "category" ALTER COLUMN "name_key" TYPE character varying(100)');
const r = await db.query(`SELECT character_maximum_length AS len, is_nullable FROM information_schema.columns WHERE table_name = 'category' AND column_name = 'name_key'`);
console.log(r.rows[0]);
await db.end();
