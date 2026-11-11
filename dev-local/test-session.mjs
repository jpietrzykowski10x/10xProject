// Manual-test helper for the local dev database (subtracker-db-dev): a temporary session instead of
// signing in by e-mail, and sample subscriptions added through the real API.
//
// Run from backend-subtracker/ (so .env and node_modules/pg resolve):
//   node --env-file=.env ../dev-local/test-session.mjs create [email]   -> session for the browser
//   node --env-file=.env ../dev-local/test-session.mjs seed [email]     -> 5 sample subscriptions
//   node --env-file=.env ../dev-local/test-session.mjs cleanup [email]  -> remove both
//
// [email] is an existing account in subtracker-db-dev; without it DEV_USER_EMAIL from .env is used.
// Nothing secret is written to disk or kept in this file: the session token exists only in memory
// and, for `create`, on the console (the browser needs it). `seed` makes its own short-lived session
// for the API calls and deletes it at the end. Sessions made here have user_agent 'manual-test'.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { assertLocalDev } from './local-only.mjs';

assertLocalDev();

const require = createRequire(join(process.cwd(), 'package.json'));
const { Client } = require('pg');

const API = process.env.TEST_API_URL ?? 'http://localhost:3000';
const COOKIE = 'subtracker_session';
const USER_AGENT = 'manual-test';
const SEED_NAMES = ['Netflix', 'Adobe Creative Cloud', 'Disney+', 'Siłownia Pro', 'Gazeta Codzienna'];

const db = new Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE_DEV,
});

// YYYY-MM-DD, `days` from today, from local date parts.
const dayFromToday = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function userId(email) {
  if (!email) {
    throw new Error('Give an e-mail (argument) or set DEV_USER_EMAIL in backend-subtracker/.env');
  }
  const u = await db.query('SELECT id FROM "user" WHERE email = $1', [email.trim().toLowerCase()]);
  if (!u.rowCount) throw new Error(`No such account in ${process.env.POSTGRES_DATABASE_DEV}`);
  return u.rows[0].id;
}

// A new session; returns its id and the raw token (the database keeps only its sha256).
async function newSession(user) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const s = await db.query(
    `INSERT INTO session (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, now() + interval '1 day', $3) RETURNING id`,
    [user, hash, USER_AGENT],
  );
  return { id: s.rows[0].id, token };
}

async function create(email) {
  const { token } = await newSession(await userId(email));
  console.log('Temporary session created (valid 1 day, removed by `cleanup`).');
  console.log('In the browser on http://localhost:4200 (DevTools console; type "allow pasting" first');
  console.log('if Chrome blocks it), or add the cookie in DevTools > Application > Cookies:');
  console.log(`  document.cookie = "${COOKIE}=${token}; path=/"`);
}

async function seed(email) {
  const session = await newSession(await userId(email));
  const headers = { Cookie: `${COOKIE}=${session.token}`, 'Content-Type': 'application/json' };
  try {
    const categories = await (await fetch(`${API}/categories`, { headers })).json();
    const category = (name) => categories.find((c) => c.name === name).id;
    const items = [
      { name: 'Netflix', categoryId: category('Streaming'), amount: 43, billingCycle: 'monthly', paymentMethod: 'credit_card', status: 'active', nextBillingDate: dayFromToday(4) },
      { name: 'Adobe Creative Cloud', categoryId: category('Oprogramowanie i narzędzia'), amount: 1233.87, billingCycle: 'yearly', paymentMethod: 'bank_transfer', status: 'active', nextBillingDate: dayFromToday(120) },
      { name: 'Disney+', categoryId: category('Streaming'), amount: 0, billingCycle: 'monthly', paymentMethod: 'blik', status: 'trial', trialEndDate: dayFromToday(2), nextBillingDate: dayFromToday(2) },
      { name: 'Siłownia Pro', categoryId: category('Zdrowie i sport'), amount: 129.99, billingCycle: 'monthly', paymentMethod: 'debit_card', status: 'cancelled_pending', nextBillingDate: dayFromToday(10) },
      { name: 'Gazeta Codzienna', categoryId: category('Prasa i książki'), amount: 19.9, billingCycle: 'monthly', paymentMethod: 'e_wallet', status: 'cancelled', nextBillingDate: dayFromToday(-15) },
    ];
    for (const body of items) {
      const res = await fetch(`${API}/subscriptions`, { method: 'POST', headers, body: JSON.stringify(body) });
      console.log(res.status, body.name, res.ok ? '' : JSON.stringify(await res.json()));
    }
  } finally {
    await db.query('DELETE FROM session WHERE id = $1', [session.id]);
  }
}

// Removes the seeded subscriptions (by name) and the manual-test sessions: of one account, or of
// every account that has such a session when no e-mail is given.
async function cleanup(email) {
  const owners = email
    ? [await userId(email)]
    : (await db.query('SELECT DISTINCT user_id FROM session WHERE user_agent = $1', [USER_AGENT])).rows.map((r) => r.user_id);
  const subs = await db.query(
    'DELETE FROM subscription WHERE name = ANY($1::text[]) AND user_id = ANY($2::uuid[])',
    [SEED_NAMES, owners],
  );
  const sessions = await db.query(
    'DELETE FROM session WHERE user_agent = $1 AND user_id = ANY($2::uuid[])',
    [USER_AGENT, owners],
  );
  console.log(`Deleted ${subs.rowCount} subscription(s), ${sessions.rowCount} session(s)`);
}

const [command, emailArg] = process.argv.slice(2);
const email = emailArg ?? process.env.DEV_USER_EMAIL;
const commands = { create, seed, cleanup };
if (!commands[command]) {
  console.log('Usage: node --env-file=.env ../dev-local/test-session.mjs create|seed|cleanup [email]');
  process.exit(1);
}
await db.connect();
try {
  await commands[command](email);
} finally {
  await db.end();
}
