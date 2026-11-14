import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { hashToken } from '../../src/auth/services/session.service.js';
import { User } from '../../src/users/entities/user.entity.js';
import { createE2eApp } from '../support/e2e-app.js';
import { authRequests, PAST } from './auth-e2e.js';

describe('Auth flow (e2e)', () => {
  // Runs against the local dev database with a fake mail transport. Every row these tests create
  // hangs off a recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-token-' });
  const { newAddress, repository } = e2e;
  const { postRegister, postRequestLink, postVerify, latestToken, findUser } =
    authRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  describe('token rules', () => {
    it('refuses a token used for the second time', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await latestToken(address);

      await postVerify(token).expect(200);

      await postVerify(token).expect(401);
    });

    it('lets only one of two simultaneous requests use a token', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await latestToken(address);

      const responses = await Promise.all([
        postVerify(token),
        postVerify(token),
      ]);

      const statuses = responses.map((response) => response.status);
      expect(statuses.sort((a, b) => a - b)).toEqual([200, 401]);
      const user = await findUser(address);
      expect(await repository(Session).countBy({ userId: user.id })).toBe(1);
    });

    it('refuses an expired token', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await latestToken(address);
      await repository(MagicLinkToken).update(
        { tokenHash: hashToken(token) },
        { expiresAt: PAST },
      );

      await postVerify(token).expect(401);

      expect((await findUser(address)).emailVerifiedAt).toBeNull();
    });

    it('refuses an older token once a new one is issued', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const older = await latestToken(address);

      await postRequestLink(address).expect(202);
      const newer = await latestToken(address, 2);

      await postVerify(older).expect(401);
      await postVerify(newer).expect(200);
    });

    it('refuses an unknown token with the same answer as a used one', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await latestToken(address);
      await postVerify(token).expect(200);

      const used = await postVerify(token).expect(401);
      const unknown = await postVerify('nieznany-token').expect(401);

      expect(unknown.body).toEqual(used.body);
    });

    // Login CSRF: a foreign page auto-posts the attacker's own token to sign the victim in.
    it('refuses a token posted from a foreign site and leaves it usable', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await latestToken(address);

      const forged = await postVerify(token)
        .set('Origin', 'https://example.com')
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);

      expect(forged.headers['set-cookie']).toBeUndefined();
      const user = await findUser(address);
      expect(await repository(Session).countBy({ userId: user.id })).toBe(0);
      await postVerify(token).expect(200);
    });

    it('refuses the token of an inactive user and creates no session', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      const token = await latestToken(address);
      await repository(User).update({ email: address }, { isActive: false });

      const response = await postVerify(token).expect(401);

      expect(response.headers['set-cookie']).toBeUndefined();
      const user = await findUser(address);
      expect(await repository(Session).countBy({ userId: user.id })).toBe(0);
    });
  });
});
