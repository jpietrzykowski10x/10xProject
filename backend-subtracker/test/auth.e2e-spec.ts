import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource, In, Like, type ObjectLiteral } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { PRIVACY_POLICY_VERSION } from './../src/auth/auth.constants.js';
import { MagicLinkToken } from './../src/auth/entities/magic-link-token.entity.js';
import { Session } from './../src/auth/entities/session.entity.js';
import { AuthService } from './../src/auth/services/auth.service.js';
import { hashToken } from './../src/auth/services/session.service.js';
import { type EnvConfig, envFromConfig } from './../src/config/env.js';
import { Mail } from './../src/mail/entities/mail.entity.js';
import { MAIL_TRANSPORT } from './../src/mail/mail.transport.js';
import { type MailMessage, MailStatus } from './../src/mail/mail.types.js';
import type { AuthUser } from './../src/shared/types/auth-user.js';
import { RoleCode } from './../src/shared/types/role-code.js';
import { grantAdmin } from './../src/users/grant-admin.js';
import { UserRole } from './../src/users/entities/user-role.entity.js';
import { EMAIL_MAX_LENGTH, User } from './../src/users/entities/user.entity.js';

// Runs against the local dev database with a fake transport: no real mail goes out. Every row
// these tests create hangs off a recognisable address and is removed at the end.
const ADDRESS_PREFIX = 'e2e-auth-';
const ADDRESS_DOMAIN = '@subtracker.test';
const ADDRESS_PATTERN = `${ADDRESS_PREFIX}%${ADDRESS_DOMAIN}`;
const OLD_CONSENT_DATE = new Date('2020-01-01T00:00:00.000Z');
const OLD_POLICY_VERSION = 'old-version';
const CONSENT_SENTENCE = '18 lat';
const PAST = new Date('2020-01-01T00:00:00.000Z');

describe('Auth flow (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let env: EnvConfig;
  const sent: MailMessage[] = [];
  let addressCounter = 0;

  const http = () => request(app.getHttpServer());
  const newAddress = () =>
    `${ADDRESS_PREFIX}${Date.now()}-${++addressCounter}${ADDRESS_DOMAIN}`;
  const repository = <T extends ObjectLiteral>(entity: new () => T) =>
    dataSource.getRepository(entity);

  async function removeTestData(): Promise<void> {
    const users = await repository(User).findBy({
      email: Like(ADDRESS_PATTERN),
    });
    const userIds = In(users.map((user) => user.id));
    await repository(Session).delete({ userId: userIds });
    await repository(MagicLinkToken).delete({ userId: userIds });
    await repository(UserRole).delete({ userId: userIds });
    await repository(User).delete({ id: userIds });
    await repository(Mail).delete({ recipient: Like(ADDRESS_PATTERN) });
  }

  // Mail is sent after the response, and the audit row is written after the transport finishes.
  async function waitForAuditRows(): Promise<void> {
    await vi.waitFor(
      async () => {
        const rows = await repository(Mail).countBy({
          recipient: Like(ADDRESS_PATTERN),
        });
        expect(rows).toBe(sent.length);
      },
      { timeout: 5000 },
    );
  }

  const postRegister = (email: string) =>
    http()
      .post('/auth/register')
      .send({ email, confirmedAdult: true, acceptedPrivacyPolicy: true });

  const postRequestLink = (email: string) =>
    http().post('/auth/request-link').send({ email });

  const postVerify = (token: string) =>
    http().post('/auth/verify').send({ token });

  const getMe = (cookie: string) =>
    http().get('/auth/me').set('Cookie', cookie);

  async function mailsTo(address: string, count = 1): Promise<MailMessage[]> {
    await vi.waitFor(() => {
      expect(sent.filter((mail) => mail.to === address)).toHaveLength(count);
    });
    return sent.filter((mail) => mail.to === address);
  }

  function tokenIn(mail: MailMessage): string {
    const token = /#token=([\w-]+)/.exec(mail.text)?.[1];
    if (token === undefined) {
      throw new Error('The mail holds no token');
    }
    return token;
  }

  async function latestToken(address: string, count = 1): Promise<string> {
    const mails = await mailsTo(address, count);
    return tokenIn(mails[count - 1]);
  }

  function setCookieOf(response: Response): string {
    const header = response.headers['set-cookie'] as unknown as
      string[] | undefined;
    if (header === undefined || header.length !== 1) {
      throw new Error('Expected exactly one Set-Cookie header');
    }
    return header[0];
  }

  const cookiePairOf = (response: Response) =>
    setCookieOf(response).split(';')[0];

  async function signIn(address: string): Promise<string> {
    await postRegister(address).expect(202);
    const response = await postVerify(await latestToken(address)).expect(200);
    return cookiePairOf(response);
  }

  const neutralShape = (response: Response) => ({
    status: response.status,
    text: response.text,
    setCookie: response.headers['set-cookie'] as unknown,
  });

  const findUser = (address: string) =>
    repository(User).findOneByOrFail({ email: address });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue({
        send: (message: MailMessage) => {
          sent.push(message);
          return Promise.resolve();
        },
      })
      .compile();

    env = envFromConfig(
      moduleFixture.get<ConfigService<EnvConfig, true>>(ConfigService),
    );
    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    // Leftovers of a run that was killed before its cleanup.
    await removeTestData();
  });

  afterAll(async () => {
    try {
      await waitForAuditRows();
    } finally {
      await removeTestData();
      await app.close();
    }
  });

  describe('sign-in', () => {
    it('registers, verifies the mailed token and returns the user with the USER role', async () => {
      const address = newAddress();

      const registered = await postRegister(address).expect(202);
      expect(registered.text).toBe('');

      const token = await latestToken(address);
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

      const verified = await postVerify(await latestToken(address)).expect(200);

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
        `${env.FRONTEND_URL}/auth/potwierdz#token=${tokenIn(mail)}`,
      );
      expect(mail.text).toContain('15 minut');
    });

    it('signs an existing user in with a link, whatever the case of the address', async () => {
      const address = newAddress();
      await signIn(address);

      await postRequestLink(address.toUpperCase()).expect(202);

      const verified = await postVerify(await latestToken(address, 2)).expect(
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

    it('answers an inactive account like an active one, and mails nothing', async () => {
      const active = newAddress();
      await postRegister(active).expect(202);
      const inactive = newAddress();
      await postRegister(inactive).expect(202);
      await mailsTo(inactive);
      await repository(User).update({ email: inactive }, { isActive: false });

      const forActive = await postRequestLink(active);
      const forInactive = await postRequestLink(inactive);
      const registerInactive = await postRegister(inactive);

      expect(neutralShape(forInactive)).toEqual(neutralShape(forActive));
      expect(neutralShape(registerInactive)).toEqual(neutralShape(forActive));
      await mailsTo(inactive, 1);
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

  describe('unexpected errors', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('answers with a generic 500 and keeps query parameters out of the log', async () => {
      const address = newAddress();
      const failure = Object.assign(new Error('awaria bazy'), {
        code: '57P01',
        parameters: [address],
      });
      vi.spyOn(app.get(AuthService), 'requestLink').mockRejectedValue(failure);
      const logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const response = await postRequestLink(address).expect(500);

      expect(response.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(JSON.stringify(response.body)).not.toContain(address);
      expect(logged.mock.calls).toHaveLength(1);
      expect(logged.mock.calls[0][0]).toBe('awaria bazy (code: 57P01)');
      expect(JSON.stringify(logged.mock.calls)).not.toContain(address);
    });

    it('keeps the status of a body parser error', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await http()
        .post('/auth/request-link')
        .send({ email: 'a'.repeat(200 * 1024) })
        .expect(413);
    });
  });

  it('shows ADMIN after grantAdmin', async () => {
    const address = newAddress();
    const cookie = await signIn(address);

    await grantAdmin(dataSource, address);
    await grantAdmin(dataSource, address);

    const me = await getMe(cookie).expect(200);
    const roles = (me.body as AuthUser).roles;
    expect([...roles].sort()).toEqual([RoleCode.ADMIN, RoleCode.USER]);
  });

  it('keeps the token out of the mail audit row', async () => {
    const address = newAddress();
    await postRegister(address).expect(202);
    const token = await latestToken(address);

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
