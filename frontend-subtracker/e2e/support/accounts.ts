import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';

// Accounts and sessions for the browser e2e tests, written straight to the app's database (no
// sign-in mail), and the cleanup of everything a test file left behind. The counterpart of
// backend-subtracker/test/support/e2e-app.ts. playwright.config.ts loads backend-subtracker/.env
// and refuses to start outside the local DEV setup.

export const API_ORIGIN = 'http://localhost:3000';

export const ADDRESS_DOMAIN = '@subtracker.test';

// The session cookie the API sets (backend SessionService).
export const SESSION_COOKIE = 'subtracker_session';

// The current version in backend-subtracker/src/auth/auth.constants.ts.
const PRIVACY_POLICY_VERSION = '0-placeholder';

// RoleCode.USER in the backend; looked up by code, the id is not repeated here.
const USER_ROLE_CODE = 'USER';

// Marks the sessions made here, like 'manual-test' in dev-local/test-session.mjs.
const USER_AGENT = 'e2e-browser';

export interface E2eAccountsOptions {
  // Every row a file creates hangs off addresses with this prefix, so the cleanup removes only
  // that file's data. Starts with `e2e-browser-` (the backend e2e use `e2e-<area>-`).
  addressPrefix: string;
}

export interface E2eAccount {
  id: string;
  email: string;
}

export interface SessionOptions {
  // A session whose expiry is an hour gone: the API treats its cookie as signed out.
  expired?: boolean;
}

export interface E2eAccounts {
  // A new active account with consents and the USER role.
  newAccount: () => Promise<E2eAccount>;
  // A new session for the account; returns the raw token (the database keeps only its sha256).
  sessionFor: (account: E2eAccount, options?: SessionOptions) => Promise<string>;
  // Removes every row hanging off this file's addresses; call in afterAll (and beforeAll for
  // leftovers of a killed run).
  removeTestData: () => Promise<void>;
  // Closes the database connection.
  close: () => Promise<void>;
}

// The session cookie in the shape of BrowserContext.addCookies. Host-only on localhost, so the
// browser sends it both to the SSR server (:4000) and to the API (:3000).
export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax' as const,
  };
}

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing ${key} in backend-subtracker/.env`);
  }
  return value;
}

// Connects lazily to the database the API uses in MODE=DEV (POSTGRES_DATABASE_DEV): locally
// subtracker-db-dev, in CI the only database.
export function createE2eAccounts({ addressPrefix }: E2eAccountsOptions): E2eAccounts {
  if (!addressPrefix.startsWith('e2e-browser-')) {
    throw new Error(`addressPrefix must start with "e2e-browser-", got "${addressPrefix}"`);
  }
  const addressPattern = `${addressPrefix}%${ADDRESS_DOMAIN}`;
  let addressCounter = 0;
  let connected: Promise<Client> | undefined;

  function db(): Promise<Client> {
    connected ??= (async () => {
      const client = new Client({
        host: requireEnv('POSTGRES_HOST'),
        port: Number(process.env['POSTGRES_PORT'] ?? 5432),
        user: requireEnv('POSTGRES_USER'),
        password: requireEnv('POSTGRES_PASSWORD'),
        database: requireEnv('POSTGRES_DATABASE_DEV'),
      });
      await client.connect();
      return client;
    })();
    return connected;
  }

  async function newAccount(): Promise<E2eAccount> {
    const client = await db();
    const email = `${addressPrefix}${Date.now()}-${++addressCounter}${ADDRESS_DOMAIN}`;
    const user = await client.query<{ id: string }>(
      `INSERT INTO "user" (email, email_verified_at, consents_accepted_at, privacy_policy_version)
       VALUES ($1, now(), now(), $2) RETURNING id`,
      [email, PRIVACY_POLICY_VERSION],
    );
    const id = user.rows[0].id;
    const role = await client.query(
      `INSERT INTO user_role (user_id, role_id)
       SELECT $1, id FROM role WHERE code = $2`,
      [id, USER_ROLE_CODE],
    );
    if (role.rowCount !== 1) {
      throw new Error(`No role with code ${USER_ROLE_CODE} in the database`);
    }
    return { id, email };
  }

  async function sessionFor(account: E2eAccount, { expired = false }: SessionOptions = {}) {
    const client = await db();
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const expiresAt = expired ? "now() - interval '1 hour'" : "now() + interval '1 day'";
    await client.query(
      `INSERT INTO session (user_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, ${expiresAt}, $3)`,
      [account.id, hash, USER_AGENT],
    );
    return token;
  }

  // Subscriptions and categories first: they hang off the users. Session, token and role rows
  // block deleting a user (ON DELETE NO ACTION). Same order as e2e-app.ts.
  async function removeTestData(): Promise<void> {
    const client = await db();
    const users = await client.query<{ id: string }>('SELECT id FROM "user" WHERE email LIKE $1', [
      addressPattern,
    ]);
    const ids = users.rows.map((row) => row.id);
    if (ids.length === 0) {
      return;
    }
    for (const table of ['subscription', 'category', 'session', 'magic_link_token', 'user_role']) {
      await client.query(`DELETE FROM ${table} WHERE user_id = ANY($1::uuid[])`, [ids]);
    }
    await client.query('DELETE FROM "user" WHERE id = ANY($1::uuid[])', [ids]);
  }

  async function close(): Promise<void> {
    if (connected === undefined) {
      return;
    }
    const client = await connected;
    connected = undefined;
    await client.end();
  }

  return { newAccount, sessionFor, removeTestData, close };
}
