import type { Response, Test } from 'supertest';
import type { MailMessage } from '../../src/mail/mail.types.js';
import { User } from '../../src/users/entities/user.entity.js';
import type { E2eApp } from '../support/e2e-app.js';

export const PAST = new Date('2020-01-01T00:00:00.000Z');

export function tokenIn(mail: MailMessage): string {
  const token = /#token=([\w-]+)/.exec(mail.text)?.[1];
  if (token === undefined) {
    throw new Error('The mail holds no token');
  }
  return token;
}

export function setCookieOf(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  if (header === undefined || header.length !== 1) {
    throw new Error('Expected exactly one Set-Cookie header');
  }
  return header[0];
}

// Requests and mail lookups shared by the auth e2e files. Unlike the generic helpers, these take
// the address from the test and count the mails sent to it.
export interface AuthRequests {
  postRegister: (email: string) => Test;
  postRequestLink: (email: string) => Test;
  postVerify: (token: string) => Test;
  getMe: (cookie: string) => Test;
  // Waits until exactly `count` mails went to the address and returns them in order.
  mailsTo: (address: string, count?: number) => Promise<MailMessage[]>;
  // The token from the `count`-th mail sent to the address.
  latestToken: (address: string, count?: number) => Promise<string>;
  // Registers the address, verifies its link and returns the session cookie pair.
  signIn: (address: string) => Promise<string>;
  findUser: (address: string) => Promise<User>;
}

export function authRequests(e2e: E2eApp): AuthRequests {
  const { http, sent, repository, cookiePairOf } = e2e;

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

  async function latestToken(address: string, count = 1): Promise<string> {
    const mails = await mailsTo(address, count);
    return tokenIn(mails[count - 1]);
  }

  async function signIn(address: string): Promise<string> {
    await postRegister(address).expect(202);
    const response = await postVerify(await latestToken(address)).expect(200);
    return cookiePairOf(response);
  }

  const findUser = (address: string) =>
    repository(User).findOneByOrFail({ email: address });

  return {
    postRegister,
    postRequestLink,
    postVerify,
    getMe,
    mailsTo,
    latestToken,
    signIn,
    findUser,
  };
}
