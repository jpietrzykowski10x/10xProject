import { Session } from '../../src/auth/entities/session.entity.js';
import { RoleCode } from '../../src/shared/types/role-code.js';
import { createE2eApp, PAST, setCookieOf } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

describe('Auth flow — session (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-session-' });
  const { http, newAddress, repository } = e2e;
  const { getMe, signIn, findUser } = authRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  describe('GET /auth/session', () => {
    const getSession = (cookie?: string) => {
      const pending = http().get('/auth/session');
      return cookie === undefined ? pending : pending.set('Cookie', cookie);
    };

    it('answers 200 with no user for a signed-out visitor, without caching', async () => {
      const response = await getSession()
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(response.body).toEqual({ user: null });
    });

    it('answers with the user for a valid session', async () => {
      const address = newAddress();
      const cookie = await signIn(address);

      const response = await getSession(cookie).expect(200);

      expect(response.body).toEqual({
        user: {
          id: expect.any(String) as string,
          email: address,
          roles: [RoleCode.USER],
        },
      });
    });

    it('answers with no user for an unknown, signed-out or expired session', async () => {
      await getSession('subtracker_session=nieznany')
        .expect(200)
        .expect({ user: null });

      const signedOut = await signIn(newAddress());
      await http().post('/auth/logout').set('Cookie', signedOut).expect(204);
      await getSession(signedOut).expect(200).expect({ user: null });

      const address = newAddress();
      const expired = await signIn(address);
      await repository(Session).update(
        { userId: (await findUser(address)).id },
        { expiresAt: PAST },
      );
      await getSession(expired).expect(200).expect({ user: null });
    });
  });

  describe('session lifetime', () => {
    it('refuses the cookie after signing out', async () => {
      const cookie = await signIn(newAddress());
      await getMe(cookie).expect(200);

      const loggedOut = await http()
        .post('/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      expect(setCookieOf(loggedOut)).toMatch(/^subtracker_session=;/);
      await getMe(cookie).expect(401);
    });

    it('signs out of an expired session without an error and clears the cookie', async () => {
      const address = newAddress();
      const cookie = await signIn(address);
      await repository(Session).update(
        { userId: (await findUser(address)).id },
        { expiresAt: PAST },
      );

      const loggedOut = await http()
        .post('/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      expect(setCookieOf(loggedOut)).toMatch(/^subtracker_session=;/);
    });

    it('refuses the cookie after the session expires', async () => {
      const address = newAddress();
      const cookie = await signIn(address);
      const user = await findUser(address);

      await repository(Session).update(
        { userId: user.id },
        { expiresAt: PAST },
      );

      await getMe(cookie).expect(401);
    });
  });
});
