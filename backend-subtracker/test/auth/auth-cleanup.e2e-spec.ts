import { randomBytes } from 'node:crypto';
import { In, Not } from 'typeorm';
import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { AuthCleanupService } from '../../src/auth/services/auth-cleanup.service.js';
import { hashToken } from '../../src/auth/services/session.service.js';
import { createE2eApp } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

const DAY = 24 * 60 * 60 * 1000;

describe('Auth — cleanup job (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job). The cleanup sees every account, so the assertions look only at the rows
  // of this file's account.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-cleanup-' });
  const { newAddress, repository } = e2e;
  const { getMe, signIn, findUser } = authRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  it('deletes tokens and sessions past the 7-day limit and keeps the rest', async () => {
    const address = newAddress();
    const cookie = await signIn(address);
    const userId = (await findUser(address)).id;
    const now = Date.now();
    const eightDaysAgo = new Date(now - 8 * DAY);
    const yesterday = new Date(now - DAY);
    const newHash = () => hashToken(randomBytes(32).toString('base64url'));

    const oldToken = await repository(MagicLinkToken).save({
      userId,
      tokenHash: newHash(),
      expiresAt: eightDaysAgo,
    });
    const [expiredLongAgo, revokedLongAgo, expiredYesterday] = await repository(
      Session,
    ).save([
      { userId, tokenHash: newHash(), expiresAt: eightDaysAgo },
      {
        userId,
        tokenHash: newHash(),
        expiresAt: new Date(now + DAY),
        revokedAt: eightDaysAgo,
      },
      { userId, tokenHash: newHash(), expiresAt: yesterday },
    ]);
    // The session and the used sign-in token of the account's real sign-in.
    const activeSessions = await repository(Session).findBy({
      userId,
      id: Not(In([expiredLongAgo.id, revokedLongAgo.id, expiredYesterday.id])),
    });
    const signInTokens = await repository(MagicLinkToken).findBy({
      userId,
      id: Not(oldToken.id),
    });
    expect(activeSessions).toHaveLength(1);
    expect(signInTokens).toHaveLength(1);

    const result = await e2e.app.get(AuthCleanupService).purge(new Date());

    // Other accounts may add to the counts, never take from them.
    expect(result.tokens).toBeGreaterThanOrEqual(1);
    expect(result.sessions).toBeGreaterThanOrEqual(2);
    const sessionsLeft = await repository(Session).findBy({ userId });
    expect(sessionsLeft.map((session) => session.id).sort()).toEqual(
      [activeSessions[0].id, expiredYesterday.id].sort(),
    );
    const tokensLeft = await repository(MagicLinkToken).findBy({ userId });
    expect(tokensLeft.map((token) => token.id)).toEqual([signInTokens[0].id]);
    await getMe(cookie).expect(200);
  });
});
