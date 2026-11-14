import { PRIVACY_POLICY_VERSION } from '../../src/auth/auth.constants.js';
import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { hashToken } from '../../src/auth/services/session.service.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import { MailStatus } from '../../src/mail/mail.types.js';
import type { AuthUser } from '../../src/shared/types/auth-user.js';
import { RoleCode } from '../../src/shared/types/role-code.js';
import { grantAdmin } from '../../src/users/grant-admin.js';
import { UserRole } from '../../src/users/entities/user-role.entity.js';
import { User } from '../../src/users/entities/user.entity.js';
import { createE2eApp, setCookieOf, tokenIn } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

const OLD_CONSENT_DATE = new Date('2020-01-01T00:00:00.000Z');
const OLD_POLICY_VERSION = 'old-version';
const CONSENT_SENTENCE = '18 lat';

describe('Auth flow — sign-in (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-sign-in-' });
  const { newAddress, repository, cookiePairOf } = e2e;
  const {
    postRegister,
    postRequestLink,
    postVerify,
    getMe,
    mailsTo,
    tokenFromMail,
    signIn,
    findUser,
  } = authRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  describe('sign-in', () => {
    it('registers, verifies the mailed token and returns the user with the USER role', async () => {
      const address = newAddress();

      const registered = await postRegister(address).expect(202);
      expect(registered.text).toBe('');

      const token = await tokenFromMail(address);
      expect((await findUser(address)).emailVerifiedAt).toBeNull();

      const verified = await postVerify(token).expect(200);
      expect(verified.body).toEqual({
        id: expect.any(String) as string,
        email: address,
        roles: [RoleCode.USER],
      });

      const me = await getMe(cookiePairOf(verified)).expect(200);
      expect(me.body).toEqual(verified.body);
      expect((await findUser(address)).emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('stores the consents and the policy version on a new account', async () => {
      const address = newAddress();

      await postRegister(address).expect(202);

      const user = await findUser(address);
      expect(user.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
      expect(user.consentsAcceptedAt).toBeInstanceOf(Date);
    });

    it('sets an HttpOnly, SameSite=Lax session cookie', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);

      const verified = await postVerify(await tokenFromMail(address)).expect(
        200,
      );

      const cookie = setCookieOf(verified);
      expect(cookie).toMatch(/^subtracker_session=/);
      expect(cookie).toMatch(/; HttpOnly/i);
      expect(cookie).toMatch(/; SameSite=Lax/i);
      expect(cookie).toMatch(/; Path=\//i);
      expect(cookie).toMatch(/; Max-Age=2592000/i);
    });

    it('mails the token in the URL fragment of the frontend, valid for 15 minutes', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);

      const [mail] = await mailsTo(address);

      expect(mail.text).toContain(
        `${e2e.env.FRONTEND_URL}/auth/verify#token=${tokenIn(mail)}`,
      );
      expect(mail.text).toContain('15 minut');
    });

    it('signs an existing user in with a link, whatever the case of the address', async () => {
      const address = newAddress();
      await signIn(address);

      await postRequestLink(address.toUpperCase()).expect(202);

      const verified = await postVerify(await tokenFromMail(address, 2)).expect(
        200,
      );
      expect((verified.body as AuthUser).email).toBe(address);
    });

    it('accepts spaces around the address when registering and requesting a link', async () => {
      const address = newAddress();

      await postRegister(`  ${address} `).expect(202);
      expect((await findUser(address)).email).toBe(address);
      await mailsTo(address);

      await postRequestLink(` ${address}  `).expect(202);
      await mailsTo(address, 2);
    });
  });

  describe('repeated registration', () => {
    async function ageConsents(address: string): Promise<void> {
      await repository(User).update(
        { email: address },
        {
          consentsAcceptedAt: OLD_CONSENT_DATE,
          privacyPolicyVersion: OLD_POLICY_VERSION,
        },
      );
    }

    it('refreshes the consents of an unconfirmed account and asks to confirm them', async () => {
      const address = newAddress();
      await postRegister(address).expect(202);
      await ageConsents(address);

      await postRegister(address).expect(202);

      const user = await findUser(address);
      expect(user.consentsAcceptedAt.getTime()).toBeGreaterThan(
        OLD_CONSENT_DATE.getTime(),
      );
      expect(user.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
      const mails = await mailsTo(address, 2);
      expect(mails[1].text).toContain(CONSENT_SENTENCE);
    });

    it('does not change a confirmed account and does not ask to confirm consents', async () => {
      const address = newAddress();
      await signIn(address);
      await ageConsents(address);
      const verifiedAt = (await findUser(address)).emailVerifiedAt;

      await postRegister(address).expect(202);

      const user = await findUser(address);
      expect(user.consentsAcceptedAt).toEqual(OLD_CONSENT_DATE);
      expect(user.privacyPolicyVersion).toBe(OLD_POLICY_VERSION);
      expect(user.emailVerifiedAt).toEqual(verifiedAt);
      const mails = await mailsTo(address, 2);
      expect(mails[0].text).toContain(CONSENT_SENTENCE);
      expect(mails[1].text).not.toContain(CONSENT_SENTENCE);
    });

    it('creates one account when two registrations race, and only one link works', async () => {
      const address = newAddress();

      const responses = await Promise.all([
        postRegister(address),
        postRegister(address),
      ]);

      expect(responses.map((response) => response.status)).toEqual([202, 202]);
      expect(await repository(User).countBy({ email: address })).toBe(1);
      const user = await findUser(address);
      expect(await repository(UserRole).countBy({ userId: user.id })).toBe(1);

      const mails = await mailsTo(address, 2);
      const statuses = [];
      for (const mail of mails) {
        statuses.push((await postVerify(tokenIn(mail))).status);
      }
      expect(statuses.sort((a, b) => a - b)).toEqual([200, 401]);
    });
  });

  it('shows ADMIN after grantAdmin', async () => {
    const address = newAddress();
    const cookie = await signIn(address);

    await grantAdmin(e2e.dataSource, address);
    await grantAdmin(e2e.dataSource, address);

    const me = await getMe(cookie).expect(200);
    const roles = (me.body as AuthUser).roles;
    expect([...roles].sort()).toEqual([RoleCode.ADMIN, RoleCode.USER]);
  });

  it('keeps the token out of the mail audit row', async () => {
    const address = newAddress();
    await postRegister(address).expect(202);
    const token = await tokenFromMail(address);

    await vi.waitFor(async () => {
      expect(await repository(Mail).countBy({ recipient: address })).toBe(1);
    });

    const [row] = await repository(Mail).findBy({ recipient: address });
    expect(row.status).toBe(MailStatus.SENT);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(hashToken(token));

    const stored = await repository(MagicLinkToken).findOneByOrFail({
      tokenHash: hashToken(token),
    });
    expect(JSON.stringify(stored)).not.toContain(token);
  });
});
