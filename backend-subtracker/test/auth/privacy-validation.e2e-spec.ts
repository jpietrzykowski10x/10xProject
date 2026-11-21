import type { Response } from 'supertest';
import { IsNull } from 'typeorm';
import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import { MailType } from '../../src/mail/mail.types.js';
import { RoleCode } from '../../src/shared/types/role-code.js';
import {
  EMAIL_MAX_LENGTH,
  User,
} from '../../src/users/entities/user.entity.js';
import { ADDRESS_DOMAIN, createE2eApp } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

describe('Auth flow — privacy and validation (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-privacy-' });
  const { http, newAddress, repository, sent } = e2e;
  const { postRegister, postRequestLink, postVerify, mailsTo } =
    authRequests(e2e);

  const neutralShape = (response: Response) => ({
    status: response.status,
    text: response.text,
    setCookie: response.headers['set-cookie'] as unknown,
  });

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  describe('account privacy', () => {
    it('answers an unknown address like a known one, and mails nothing', async () => {
      const known = newAddress();
      await postRegister(known).expect(202);
      const unknown = newAddress();

      const forKnown = await postRequestLink(known);
      const forUnknown = await postRequestLink(unknown);

      expect(neutralShape(forUnknown)).toEqual(neutralShape(forKnown));
      expect(forUnknown.status).toBe(202);
      expect(forUnknown.text).toBe('');
      expect(sent.filter((mail) => mail.to === unknown)).toEqual([]);
    });

    it('answers a registration on a taken address like one on a free address', async () => {
      const address = newAddress();

      const onFree = await postRegister(address);
      const onTaken = await postRegister(address);

      expect(neutralShape(onTaken)).toEqual(neutralShape(onFree));
      expect(onTaken.status).toBe(202);
      await mailsTo(address, 2);
    });

    // The one exception to the neutral answer (S-09): the owner of a blocked account must learn why
    // signing in fails and whom to ask. Active and unknown addresses still look the same.
    it('answers a blocked account with 403 and the contact, and mails it only about the block', async () => {
      const active = newAddress();
      await postRegister(active).expect(202);
      const blocked = newAddress();
      await postRegister(blocked).expect(202);
      await mailsTo(blocked);
      await repository(User).update({ email: blocked }, { isActive: false });
      const before = await repository(User).findOneByOrFail({
        email: blocked,
      });

      const linkForActive = await postRequestLink(active);
      const linkForUnknown = await postRequestLink(newAddress());
      const registerTaken = await postRegister(active);
      const registerFree = await postRegister(newAddress());
      const registerBlocked = await postRegister(blocked);
      const linkForBlocked = await postRequestLink(blocked);

      expect(neutralShape(linkForUnknown)).toEqual(neutralShape(linkForActive));
      expect(neutralShape(registerTaken)).toEqual(neutralShape(registerFree));
      expect(neutralShape(registerFree)).toEqual(neutralShape(linkForActive));
      expect(linkForActive.status).toBe(202);
      for (const refusal of [registerBlocked, linkForBlocked]) {
        expect(refusal.status).toBe(403);
        expect(refusal.body).toEqual({
          statusCode: 403,
          code: 'account_blocked',
          contact: e2e.env.SUPPORT_EMAIL,
          message: 'Account blocked',
        });
        expect(refusal.headers['set-cookie']).toBeUndefined();
      }

      // The registration link and one mail about the block, from request-link only.
      const [, blockMail] = await mailsTo(blocked, 2);
      expect(blockMail.text).toContain(e2e.env.SUPPORT_EMAIL);
      await vi.waitFor(async () => {
        const types = (await repository(Mail).findBy({ recipient: blocked }))
          .map((mail) => mail.type)
          .sort();
        expect(types).toEqual([MailType.ACCOUNT_BLOCKED, MailType.MAGIC_LINK]);
      });
      // Registering again neither refreshed the consents nor replaced the unused link.
      const after = await repository(User).findOneByOrFail({ email: blocked });
      expect(after.consentsAcceptedAt).toEqual(before.consentsAcceptedAt);
      expect(
        await repository(MagicLinkToken).countBy({
          userId: after.id,
          usedAt: IsNull(),
        }),
      ).toBe(1);
    });
  });

  describe('validation', () => {
    it.each([
      ['no consents', {}],
      ['no adult statement', { acceptedPrivacyPolicy: true }],
      ['no policy acceptance', { confirmedAdult: true }],
      [
        'a refused consent',
        { confirmedAdult: true, acceptedPrivacyPolicy: false },
      ],
      [
        'a consent as text',
        { confirmedAdult: 'true', acceptedPrivacyPolicy: true },
      ],
    ])('refuses a registration with %s', async (_name, consents) => {
      const address = newAddress();

      await http()
        .post('/auth/register')
        .send({ email: address, ...consents })
        .expect(400);

      expect(await repository(User).countBy({ email: address })).toBe(0);
    });

    it('refuses an invalid or overlong address', async () => {
      const consents = { confirmedAdult: true, acceptedPrivacyPolicy: true };
      const overlong = `${'a'.repeat(60)}@${'b'.repeat(190)}.${'c'.repeat(10)}.pl`;

      for (const email of ['nie-adres', overlong]) {
        await http()
          .post('/auth/register')
          .send({ email, ...consents })
          .expect(400);
        await http().post('/auth/request-link').send({ email }).expect(400);
      }
    });

    it('refuses an address that lowercasing lengthens past the column', async () => {
      const consents = { confirmedAdult: true, acceptedPrivacyPolicy: true };
      const email = `${'a'.repeat(64)}@${'İ'.repeat(5)}${'b'.repeat(50)}.${'c'.repeat(63)}.${'d'.repeat(63)}.pl`;
      expect(email.length).toBeLessThanOrEqual(EMAIL_MAX_LENGTH);
      expect(email.toLowerCase().length).toBeGreaterThan(EMAIL_MAX_LENGTH);

      await http()
        .post('/auth/register')
        .send({ email, ...consents })
        .expect(400);
      await http().post('/auth/request-link').send({ email }).expect(400);
    });

    it('refuses an address with a quoted local part', async () => {
      const consents = { confirmedAdult: true, acceptedPrivacyPolicy: true };

      for (const email of [
        `"a b"${ADDRESS_DOMAIN}`,
        `"a\nb"${ADDRESS_DOMAIN}`,
      ]) {
        await http()
          .post('/auth/register')
          .send({ email, ...consents })
          .expect(400);
        await http().post('/auth/request-link').send({ email }).expect(400);
      }
    });

    it('refuses an overlong token', async () => {
      await postVerify('x'.repeat(65)).expect(400);
    });

    it('refuses a field outside the DTO', async () => {
      await http()
        .post('/auth/register')
        .send({
          email: newAddress(),
          confirmedAdult: true,
          acceptedPrivacyPolicy: true,
          isActive: false,
        })
        .expect(400);
      await http()
        .post('/auth/request-link')
        .send({ email: newAddress(), roles: [RoleCode.ADMIN] })
        .expect(400);
      await http()
        .post('/auth/verify')
        .send({ token: 'x', userId: 'y' })
        .expect(400);
    });
  });
});
