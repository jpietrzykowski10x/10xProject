import { Logger } from '@nestjs/common';
import type { Response } from 'supertest';
import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { hashToken } from '../../src/auth/services/session.service.js';
import { User } from '../../src/users/entities/user.entity.js';
import { createE2eApp, PAST } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_COOKIE = 'subtracker_session=nieznane-ciasteczko';

describe('Auth denials in the log (e2e)', () => {
  // Runs against the database from .env with a fake mail transport. Every row these tests create
  // hangs off a recognisable address and is removed at the end. Each test checks one line of its
  // own code, so the filter's limit of 10 lines per code a minute is never reached.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-denials-' });
  const { http, newAddress, repository } = e2e;
  const { postRegister, postVerify, getMe, tokenFromMail, signIn, findUser } =
    authRequests(e2e);

  let warned: ReturnType<typeof vi.spyOn>;

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  beforeEach(() => {
    warned = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The lines written in the Denials context since the spy was set.
  function denialLines(): string[] {
    return warned.mock.calls
      .filter((_call: unknown[], index: number) => {
        const logger = warned.mock.contexts[index] as { context?: string };
        return logger.context === 'Denials';
      })
      .map((call: unknown[]) => String(call[0]));
  }

  function requestIdOf(response: Response): string {
    const requestId = response.headers['x-request-id'];
    expect(requestId).toMatch(UUID);
    return String(requestId);
  }

  // Everything the spy saw, for checks that a secret is nowhere in it.
  const everything = () => JSON.stringify(warned.mock.calls);

  async function tokenIdOf(token: string): Promise<string> {
    const stored = await repository(MagicLinkToken).findOneByOrFail({
      tokenHash: hashToken(token),
    });
    return stored.id;
  }

  async function sessionIdOf(userId: string): Promise<string> {
    const session = await repository(Session).findOneByOrFail({ userId });
    return session.id;
  }

  function expectNoSecrets(...secrets: string[]): void {
    const lines = everything();
    for (const secret of secrets) {
      expect(lines).not.toContain(secret);
    }
  }

  describe('sign-in link', () => {
    it('logs link_unknown for a token no row has', async () => {
      const token = 'losowy-token-bez-wiersza';

      const response = await postVerify(token).expect(401);

      expect(denialLines()).toEqual([
        `link_unknown 401 POST /auth/verify user=- req=${requestIdOf(response)}`,
      ]);
      expectNoSecrets(token, hashToken(token));
    });

    it('logs link_used with the token id for the second use', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await tokenFromMail(address);
      await postVerify(token).expect(200);
      warned.mockClear();

      const response = await postVerify(token).expect(401);

      expect(denialLines()).toEqual([
        `link_used 401 POST /auth/verify user=- req=${requestIdOf(response)} token=${await tokenIdOf(token)}`,
      ]);
      expectNoSecrets(token, hashToken(token), address);
    });

    it('logs link_expired with the token id for an aged token', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await tokenFromMail(address);
      await repository(MagicLinkToken).update(
        { tokenHash: hashToken(token) },
        { expiresAt: PAST },
      );

      const response = await postVerify(token).expect(401);

      expect(denialLines()).toEqual([
        `link_expired 401 POST /auth/verify user=- req=${requestIdOf(response)} token=${await tokenIdOf(token)}`,
      ]);
      expectNoSecrets(token, hashToken(token), address);
    });

    it('logs link_account_blocked with the token and account ids on the same 403', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await tokenFromMail(address);
      await repository(User).update({ email: address }, { isActive: false });
      const user = await findUser(address);

      const response = await postVerify(token).expect(403);

      expect(response.body).toMatchObject({ code: 'account_blocked' });
      expect(denialLines()).toEqual([
        `link_account_blocked 403 POST /auth/verify user=- req=${requestIdOf(response)} token=${await tokenIdOf(token)} account=${user.id}`,
      ]);
      expectNoSecrets(token, hashToken(token), address);
    });

    // Issuing and checking both use the database clock (now()), so the stored lifetime is exactly
    // MAGIC_LINK_TTL after created_at (also now() of the same transaction). A clock of the app
    // would leave it off by the milliseconds between the two.
    it('stores a link that expires 15 minutes after now() of the database', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await tokenFromMail(address);

      const [row] = await e2e.dataSource.query<
        { fromCreation: number; fromNow: number }[]
      >(
        `SELECT EXTRACT(EPOCH FROM expires_at - created_at)::float8 AS "fromCreation",
                EXTRACT(EPOCH FROM expires_at - now())::float8 AS "fromNow"
           FROM magic_link_token WHERE token_hash = $1`,
        [hashToken(token)],
      );

      expect(row.fromCreation).toBe(15 * 60);
      expect(Math.abs(row.fromNow - 15 * 60)).toBeLessThanOrEqual(5);
    });
  });

  describe('session', () => {
    it('logs session_missing without a cookie', async () => {
      const response = await http().get('/auth/me').expect(401);

      expect(denialLines()).toEqual([
        `session_missing 401 GET /auth/me user=- req=${requestIdOf(response)}`,
      ]);
    });

    it('logs session_unknown for a cookie no session has, without the cookie', async () => {
      const response = await getMe(UNKNOWN_COOKIE).expect(401);

      expect(denialLines()).toEqual([
        `session_unknown 401 GET /auth/me user=- req=${requestIdOf(response)}`,
      ]);
      expectNoSecrets('nieznane-ciasteczko');
    });

    it('logs session_revoked with the session id after signing out', async () => {
      const address = newAddress();
      const cookie = await signIn(address);
      const user = await findUser(address);
      await http().post('/auth/logout').set('Cookie', cookie).expect(204);
      warned.mockClear();

      const response = await getMe(cookie).expect(401);

      expect(denialLines()).toEqual([
        `session_revoked 401 GET /auth/me user=- req=${requestIdOf(response)} session=${await sessionIdOf(user.id)}`,
      ]);
      expectNoSecrets(cookie.split('=')[1], address);
    });

    it('logs session_expired with the session id for an aged session', async () => {
      const address = newAddress();
      const cookie = await signIn(address);
      const user = await findUser(address);
      await repository(Session).update(
        { userId: user.id },
        { expiresAt: PAST },
      );
      warned.mockClear();

      const response = await getMe(cookie).expect(401);

      expect(denialLines()).toEqual([
        `session_expired 401 GET /auth/me user=- req=${requestIdOf(response)} session=${await sessionIdOf(user.id)}`,
      ]);
      expectNoSecrets(cookie.split('=')[1], address);
    });

    it('logs session_inactive with the session id for a blocked account', async () => {
      const address = newAddress();
      const cookie = await signIn(address);
      const user = await findUser(address);
      await repository(User).update({ id: user.id }, { isActive: false });
      warned.mockClear();

      const response = await getMe(cookie).expect(401);

      expect(denialLines()).toEqual([
        `session_inactive 401 GET /auth/me user=- req=${requestIdOf(response)} session=${await sessionIdOf(user.id)}`,
      ]);
      expectNoSecrets(cookie.split('=')[1], address);
    });

    it('answers GET /auth/session with an unknown cookie with 200 and no warn line', async () => {
      await http()
        .get('/auth/session')
        .set('Cookie', UNKNOWN_COOKIE)
        .expect(200)
        .expect({ user: null });

      expect(warned).not.toHaveBeenCalled();
    });
  });
});
