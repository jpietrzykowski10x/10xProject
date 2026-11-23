import { Logger } from '@nestjs/common';
import { SubscriptionsService } from '../src/subscriptions/services/subscriptions.service.js';
import { createE2eApp } from './support/e2e-app.js';
import { subscriptionBody } from './subscriptions/subscriptions-e2e.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('Request context (e2e)', () => {
  // Runs against the database from .env with a fake mail transport. Every row these tests create
  // hangs off a recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-request-context-' });
  const { http, signIn, userIdOf } = e2e;

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives every response its own X-Request-Id and ignores the one sent by the client', async () => {
    const first = await http()
      .get('/health')
      .set('X-Request-Id', 'abc')
      .expect(200);
    const second = await http().get('/health').expect(200);

    expect(first.headers['x-request-id']).toMatch(UUID);
    expect(second.headers['x-request-id']).toMatch(UUID);
    expect(first.headers['x-request-id']).not.toBe(
      second.headers['x-request-id'],
    );
  });

  it('lets an allowed origin read X-Request-Id', async () => {
    const response = await http()
      .get('/health')
      .set('Origin', e2e.env.CORS_ORIGINS[0])
      .expect(200);

    expect(response.headers['access-control-expose-headers']).toContain(
      'X-Request-Id',
    );
  });

  it('logs a 500 with the route template, the user and the request id, without the id or query from the URL', async () => {
    const { address, cookie } = await signIn();
    const userId = await userIdOf(address);
    const subscriptionId = crypto.randomUUID();
    vi.spyOn(e2e.app.get(SubscriptionsService), 'update').mockRejectedValue(
      Object.assign(new Error('awaria bazy'), {
        code: '57P01',
        parameters: [address],
      }),
    );
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const response = await http()
      .put(`/subscriptions/${subscriptionId}?x=secret`)
      .set('Cookie', cookie)
      .send(subscriptionBody())
      .expect(500);

    const requestId = response.headers['x-request-id'];
    expect(requestId).toMatch(UUID);
    expect(logged.mock.calls).toHaveLength(1);
    expect(logged.mock.calls[0][0]).toBe(
      `PUT /subscriptions/:id user=${userId} req=${requestId}: awaria bazy (code: 57P01)`,
    );
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).not.toContain('secret');
    expect(lines).not.toContain(subscriptionId);
    expect(lines).not.toContain(address);
  });
});
