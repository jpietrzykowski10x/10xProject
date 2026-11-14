import { Session } from '../../src/auth/entities/session.entity.js';
import { createE2eApp, PAST, type SignedIn } from '../support/e2e-app.js';
import { subscriptionBody, subscriptionRequests } from './subscriptions-e2e.js';

describe('Subscriptions — access (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-access-' });
  const { http, repository, signIn, userIdOf } = e2e;
  const { postSubscription, postCategory, getCategories } =
    subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  it('answers 401 on every route without a session', async () => {
    await http().get('/categories').expect(401);
    await http().post('/categories').send({ name: 'Praca' }).expect(401);
    await http().get('/subscriptions').expect(401);
    await http().post('/subscriptions').send(subscriptionBody()).expect(401);
  });

  // The global guard is covered on /auth/me in test/auth/session.e2e-spec.ts; this keeps it on the
  // domain routes.
  it.each([
    [
      'an expired session',
      async ({ address }: SignedIn) => {
        await repository(Session).update(
          { userId: await userIdOf(address) },
          { expiresAt: PAST },
        );
      },
    ],
    [
      'a signed-out session',
      async ({ cookie }: SignedIn) => {
        await http().post('/auth/logout').set('Cookie', cookie).expect(204);
      },
    ],
  ])('answers 401 on every route with %s', async (_state, endSession) => {
    const account = await signIn();
    const { cookie } = account;
    await getCategories(cookie);

    await endSession(account);

    await http().get('/categories').set('Cookie', cookie).expect(401);
    await postCategory(cookie, 'Praca').expect(401);
    await http().get('/subscriptions').set('Cookie', cookie).expect(401);
    await postSubscription(cookie, subscriptionBody()).expect(401);
  });
});
