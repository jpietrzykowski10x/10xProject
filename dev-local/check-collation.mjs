// Read-only (local diagnostics): is the ICU Polish collation available, and how does it order?
// Run from backend-subtracker/: node --env-file=.env ../dev-local/check-collation.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { assertLocalDev } from './local-only.mjs';

assertLocalDev();
const require = createRequire(join(process.cwd(), 'package.json'));
const { Client } = require('pg');
for (const database of [process.env.POSTGRES_DATABASE_DEV, process.env.POSTGRES_DATABASE]) {
  const db = new Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database });
  await db.connect();
  console.log(database, (await db.query(`SELECT collname FROM pg_collation WHERE collname IN ('pl-PL-x-icu', 'pl-x-icu')`)).rows);
  console.log((await db.query(`SELECT n FROM (VALUES ('Zoo'), ('Ślub'), ('alfa'), ('Beta'), ('słoń'), ('Sad')) v(n) ORDER BY lower(n) COLLATE "pl-PL-x-icu"`)).rows.map((r) => r.n));
  console.log((await db.query(`SELECT n FROM (VALUES ('Zoo'), ('Ślub'), ('alfa'), ('Beta'), ('słoń'), ('Sad')) v(n) ORDER BY lower(n) COLLATE "C"`)).rows.map((r) => r.n));
  await db.end();
}
