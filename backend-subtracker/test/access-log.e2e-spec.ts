import { Logger } from '@nestjs/common';
import { createE2eApp } from './support/e2e-app.js';

const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

describe('Access log (e2e)', () => {
  // Runs against the database from .env with a fake mail transport. Every row these tests create
  // hangs off a recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-access-log-' });
  const { http, signIn, userIdOf } = e2e;

  let logged: ReturnType<typeof vi.spyOn>;

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  beforeEach(() => {
    logged = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The lines written by the Logger with context `Access`.
  function accessLines(): string[] {
    const lines: string[] = [];
    logged.mock.calls.forEach((call: unknown[], index: number) => {
      const logger = logged.mock.contexts[index] as { context?: unknown };
      if (logger.context === 'Access') {
        lines.push(String(call[0]));
      }
    });
    return lines;
  }

  // The line is written at `finish`, which may come a moment after the client has the response.
  async function accessLineOf(requestId: string): Promise<string> {
    return vi.waitFor(() => {
      const lines = accessLines().filter((line) =>
        line.endsWith(` req=${requestId}`),
      );
      expect(lines).toHaveLength(1);
      return lines[0];
    });
  }

  it('logs GET /health with its status, time and request id', async () => {
    const response = await http().get('/health').expect(200);
    const requestId = response.headers['x-request-id'];

    expect(await accessLineOf(requestId)).toMatch(
      new RegExp(`^GET /health 200 \\d+ ms user=- req=${requestId}$`),
    );
  });

  it('logs an unknown path as (unrouted) 404 without the path or its query', async () => {
    const response = await http()
      .get('/nie-istnieje?token=abc&email=anna@example.com')
      .expect(404);
    const requestId = response.headers['x-request-id'];

    const line = await accessLineOf(requestId);
    expect(line).toMatch(
      new RegExp(`^GET \\(unrouted\\) 404 \\d+ ms user=- req=${requestId}$`),
    );
    for (const fragment of [
      '?',
      'nie-istnieje',
      'token',
      'abc',
      'anna@example.com',
    ]) {
      expect(line).not.toContain(fragment);
    }
    expect(JSON.stringify(accessLines())).not.toContain('anna@example.com');
  });

  it('logs the route template and the user of a request with a session, without the address', async () => {
    const { address, cookie } = await signIn();
    const userId = await userIdOf(address);

    const response = await http()
      .get('/subscriptions?email=anna@example.com')
      .set('Cookie', cookie)
      .expect(200);
    const requestId = response.headers['x-request-id'];

    expect(await accessLineOf(requestId)).toMatch(
      new RegExp(
        `^GET /subscriptions 200 \\d+ ms user=${userId} req=${requestId}$`,
      ),
    );
    expect(userId).toMatch(new RegExp(`^${UUID}$`));
    const lines = JSON.stringify(accessLines());
    expect(lines).not.toContain(address);
    expect(lines).not.toContain('anna@example.com');
    expect(lines).not.toContain('subtracker_session');
  });
});
