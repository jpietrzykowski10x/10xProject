import { ConflictException, NotFoundException } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { AccountAccessService } from '../../src/auth/services/account-access.service.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import { MailStatus, MailType } from '../../src/mail/mail.types.js';
import { createE2eApp, UNKNOWN_ID } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

describe('Auth — blocking, unblocking and signing out everywhere (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. The admin routes come later, so the tests call
  // AccountAccessService directly; everything else goes through the real API.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-access-' });
  const { newAddress, repository, userIdOf, cookiePairOf } = e2e;
  const {
    postRegister,
    postRequestLink,
    postVerify,
    getMe,
    mailsTo,
    tokenFromMail,
    signIn,
  } = authRequests(e2e);

  const access = () => e2e.app.get(AccountAccessService);

  // The types of the mail audit rows of the address, sorted, once there are `count` of them. Audit
  // rows are written after sending, so their order is not the order of the mails.
  async function mailTypesOf(address: string, count: number) {
    let types: MailType[] = [];
    await vi.waitFor(async () => {
      const rows = await repository(Mail).findBy({ recipient: address });
      expect(rows).toHaveLength(count);
      types = rows.map((row) => row.type).sort();
    });
    return types;
  }

  // An account signed in on two devices, with one more link issued and not used yet. Mail so far:
  // the registration link and the second link (3 with the unused one).
  async function accountWithTwoSessionsAndALink() {
    const address = newAddress();
    const firstDevice = await signIn(address);
    await postRequestLink(address).expect(202);
    const secondDevice = cookiePairOf(
      await postVerify(await tokenFromMail(address, 2)).expect(200),
    );
    await postRequestLink(address).expect(202);
    const unusedToken = await tokenFromMail(address, 3);
    return {
      address,
      userId: await userIdOf(address),
      cookies: [firstDevice, secondDevice],
      unusedToken,
    };
  }

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  describe('block', () => {
    it('ends every session, deletes the unused link and mails the owner with the contact', async () => {
      const { address, userId, cookies, unusedToken } =
        await accountWithTwoSessionsAndALink();
      for (const cookie of cookies) {
        await getMe(cookie).expect(200);
      }

      const user = await access().block(userId);

      expect(user).toMatchObject({ id: userId, isActive: false });
      for (const cookie of cookies) {
        await getMe(cookie).expect(401);
      }
      expect(
        await repository(Session).countBy({ userId, revokedAt: IsNull() }),
      ).toBe(0);
      expect(
        await repository(MagicLinkToken).countBy({ userId, usedAt: IsNull() }),
      ).toBe(0);
      // The used links stay: the cleanup job removes them.
      expect(
        await repository(MagicLinkToken).countBy({
          userId,
          usedAt: Not(IsNull()),
        }),
      ).toBe(2);
      await postVerify(unusedToken).expect(401);

      const mails = await mailsTo(address, 4);
      expect(mails[3].text).toContain(e2e.env.SUPPORT_EMAIL);
      expect(await mailTypesOf(address, 4)).toEqual([
        MailType.ACCOUNT_BLOCKED,
        MailType.MAGIC_LINK,
        MailType.MAGIC_LINK,
        MailType.MAGIC_LINK,
      ]);
    });

    it('answers 409 for a blocked account and mails nothing more', async () => {
      const address = newAddress();
      await signIn(address);
      const userId = await userIdOf(address);
      await access().block(userId);
      await mailsTo(address, 2);

      await expect(access().block(userId)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(await mailTypesOf(address, 2)).toEqual([
        MailType.ACCOUNT_BLOCKED,
        MailType.MAGIC_LINK,
      ]);
    });
  });

  describe('mail about the block', () => {
    it('goes out again on a link request at most once an hour', async () => {
      const address = newAddress();
      await signIn(address);
      await access().block(await userIdOf(address));
      // The registration link and the mail of the block itself.
      await mailTypesOf(address, 2);

      await postRequestLink(address).expect(403);
      await postRequestLink(address).expect(403);
      // An hour later the next request sends it again.
      await repository(Mail).update(
        { recipient: address, type: MailType.ACCOUNT_BLOCKED },
        { createdAt: new Date(Date.now() - 61 * 60 * 1000) },
      );
      await postRequestLink(address).expect(403);

      expect(await mailTypesOf(address, 3)).toEqual([
        MailType.ACCOUNT_BLOCKED,
        MailType.ACCOUNT_BLOCKED,
        MailType.MAGIC_LINK,
      ]);
      expect(await mailsTo(address, 3)).toHaveLength(3);
    });

    it('is not tried again within the hour after a failed attempt', async () => {
      const address = newAddress();
      await signIn(address);
      e2e.failMailTo(address, true);
      await access().block(await userIdOf(address));
      // The registration link and the failed mail of the block itself.
      await mailTypesOf(address, 2);
      e2e.failMailTo(address, false);

      await postRequestLink(address).expect(403);
      await postRequestLink(address).expect(403);
      // An hour later the next request tries again, and this time the mail goes out.
      await repository(Mail).update(
        { recipient: address, type: MailType.ACCOUNT_BLOCKED },
        { createdAt: new Date(Date.now() - 61 * 60 * 1000) },
      );
      await postRequestLink(address).expect(403);

      expect(await mailTypesOf(address, 3)).toEqual([
        MailType.ACCOUNT_BLOCKED,
        MailType.ACCOUNT_BLOCKED,
        MailType.MAGIC_LINK,
      ]);
      const blockedStatuses = (
        await repository(Mail).findBy({
          recipient: address,
          type: MailType.ACCOUNT_BLOCKED,
        })
      )
        .map((row) => row.status)
        .sort();
      expect(blockedStatuses).toEqual([MailStatus.FAILED, MailStatus.SENT]);
      expect(e2e.sent.filter((mail) => mail.to === address)).toHaveLength(3);
    });
  });

  describe('unblock', () => {
    it('lets the owner sign in again with a new link, while a link from before the block stays dead', async () => {
      const address = newAddress();
      await signIn(address);
      await postRequestLink(address).expect(202);
      const linkBeforeBlock = await tokenFromMail(address, 2);
      const userId = await userIdOf(address);
      await access().block(userId);
      // Link, link, the block; once its audit row is there, request-link does not mail it again.
      await mailTypesOf(address, 3);
      await postRequestLink(address).expect(403);

      const user = await access().unblock(userId);

      expect(user).toMatchObject({ id: userId, isActive: true });
      const mails = await mailsTo(address, 4);
      expect(mails[3].text).toContain(`${e2e.env.FRONTEND_URL}/sign-in`);
      expect(await mailTypesOf(address, 4)).toEqual([
        MailType.ACCOUNT_BLOCKED,
        MailType.ACCOUNT_UNBLOCKED,
        MailType.MAGIC_LINK,
        MailType.MAGIC_LINK,
      ]);
      await postVerify(linkBeforeBlock).expect(401);
      await postRequestLink(address).expect(202);
      const cookie = cookiePairOf(
        await postVerify(await tokenFromMail(address, 5)).expect(200),
      );
      await getMe(cookie).expect(200);
    });

    it('answers 409 for an active account', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      await mailsTo(address);

      await expect(
        access().unblock(await userIdOf(address)),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('resetSessions', () => {
    it('ends every session and the unused link but keeps the account active', async () => {
      const { address, userId, cookies, unusedToken } =
        await accountWithTwoSessionsAndALink();

      const user = await access().resetSessions(userId);

      expect(user).toMatchObject({ id: userId, isActive: true });
      for (const cookie of cookies) {
        await getMe(cookie).expect(401);
      }
      await postVerify(unusedToken).expect(401);
      expect(await mailTypesOf(address, 4)).toEqual([
        MailType.MAGIC_LINK,
        MailType.MAGIC_LINK,
        MailType.MAGIC_LINK,
        MailType.SESSIONS_RESET,
      ]);
      // Signing in again works as usual.
      await postRequestLink(address).expect(202);
      const cookie = cookiePairOf(
        await postVerify(await tokenFromMail(address, 5)).expect(200),
      );
      await getMe(cookie).expect(200);
    });

    it('answers 409 for a blocked account', async () => {
      const address = newAddress();
      await signIn(address);
      const userId = await userIdOf(address);
      await access().block(userId);

      await expect(access().resetSessions(userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await mailsTo(address, 2);
    });
  });

  it.each([
    ['block', (service: AccountAccessService) => service.block(UNKNOWN_ID)],
    ['unblock', (service: AccountAccessService) => service.unblock(UNKNOWN_ID)],
    [
      'resetSessions',
      (service: AccountAccessService) => service.resetSessions(UNKNOWN_ID),
    ],
  ])('%s answers 404 for an unknown account', async (_name, action) => {
    await expect(action(access())).rejects.toBeInstanceOf(NotFoundException);
  });
});
