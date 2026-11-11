// Read-only: category rows, name_key column and indexes in both local databases (local diagnostics).
// Run from backend-subtracker/: node --env-file=.env ../dev-local/inspect-category.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { assertLocalDev } from './local-only.mjs';

assertLocalDev();
const require = createRequire(join(process.cwd(), 'package.json'));
const { Client } = require('pg');
for (const database of [process.env.POSTGRES_DATABASE, process.env.POSTGRES_DATABASE_DEV]) {
  const db = new Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database });
  await db.connect();
  console.log('==', database);
  console.log((await db.query(`SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()`)).rows);
  console.log((await db.query(`SELECT count(*)::int AS total, count(user_id)::int AS own FROM category`)).rows);
  console.log((await db.query(`SELECT column_name, is_nullable, character_maximum_length FROM information_schema.columns WHERE table_name = 'category' ORDER BY ordinal_position`)).rows);
  console.log((await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'category'`)).rows);
  console.log((await db.query(`SELECT lower('ŚŻŁĆ') AS l`)).rows);
  await db.end();
}
