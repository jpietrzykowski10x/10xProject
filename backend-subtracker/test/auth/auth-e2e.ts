import type { Test } from 'supertest';
import type { MailMessage } from '../../src/mail/mail.types.js';
import { User } from '../../src/users/entities/user.entity.js';
import { type E2eApp, tokenIn } from '../support/e2e-app.js';

// Requests and mail lookups shared by the auth e2e files. Unlike the generic helpers, these take
// the address from the test and count the mails sent to it.
export interface AuthRequests {
  postRegister: (email: string) => Test;
  postRequestLink: (email: string) => Test;
  postVerify: (token: string) => Test;
  getMe: (cookie: string) => Test;
  // Waits until exactly `count` mails went to the address and returns them in order.
  mailsTo: (address: string, count?: number) => Promise<MailMessage[]>;
  // Waits until exactly `nth` mails went to the address and returns the token of the `nth` one.
  tokenFromMail: (address: string, nth?: number) => Promise<string>;
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

  async function tokenFromMail(address: string, nth = 1): Promise<string> {
    const mails = await mailsTo(address, nth);
    return tokenIn(mails[nth - 1]);
  }

  async function signIn(address: string): Promise<string> {
    await postRegister(address).expect(202);
    const response = await postVerify(await tokenFromMail(address)).expect(200);
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
    tokenFromMail,
    signIn,
    findUser,
  };
}
