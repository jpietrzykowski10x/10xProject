import { Logger } from '@nestjs/common';
import type { Response } from 'supertest';
import { RoleCode } from '../src/shared/types/role-code.js';
import { adminRequests } from './admin/admin-e2e.js';
import { createE2eApp } from './support/e2e-app.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FOREIGN_ORIGIN = 'https://evil.example';

describe('Denials in the log (e2e)', () => {
  // Runs against the database from .env with a fake mail transport. Every row these tests create
  // hangs off a recognisable address and is removed at the end, roles and audit rows with it.
  // The filter, and so its limit of 10 lines per code a minute, lives for the whole file: every
  // test checks one line of its own code, and the limit itself is covered by the unit tests.
  const e2e = createE2eApp({ addressPrefix: 'e2e-denials-' });
  const { http, newAddress } = e2e;
  const { account, searchUsers, postAction } = adminRequests(e2e);

  let warned: ReturnType<typeof vi.spyOn>;

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  beforeEach(() => {
    warned = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The lines written in the Denials context since the spy was set.
  function denialLines(): string[] {
    return warned.mock.calls
      .filter((_call: unknown[], index: number) => {
        const logger = warned.mock.contexts[index] as { context?: string };
        return logger.context === 'Denials';
      })
      .map((call: unknown[]) => String(call[0]));
  }

  function requestIdOf(response: Response): string {
    const requestId = response.headers['x-request-id'];
    expect(requestId).toMatch(UUID);
    return String(requestId);
  }

  describe('CSRF', () => {
    // Also guards the two texts of Nest's cross-origin check the filter recognises: an upgrade that
    // changes them turns these lines off.
    it('logs a refusal by Sec-Fetch-Site with the origin, without the query', async () => {
      const address = newAddress();

      const response = await http()
        .post(`/auth/logout?email=${address}`)
        .set('Origin', FOREIGN_ORIGIN)
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);

      expect(denialLines()).toEqual([
        `csrf_sec_fetch_site 403 POST (unrouted) user=- req=${requestIdOf(response)} origin=${FOREIGN_ORIGIN}`,
      ]);
      expect(JSON.stringify(warned.mock.calls)).not.toContain(address);
    });

    it('logs a refusal by Origin from a browser without Sec-Fetch-Site', async () => {
      const response = await http()
        .post('/auth/logout')
        .set('Origin', `${FOREIGN_ORIGIN}/strona?x=secret`)
        .expect(403);

      expect(denialLines()).toEqual([
        `csrf_origin 403 POST (unrouted) user=- req=${requestIdOf(response)} origin=${FOREIGN_ORIGIN}`,
      ]);
      expect(JSON.stringify(warned.mock.calls)).not.toContain('secret');
    });
  });

  describe('validation', () => {
    it('names the wrong field and the field outside the DTO, without the typed address', async () => {
      const typed = newAddress().replace('@', ' ');

      const response = await http()
        .post('/auth/register')
        .send({
          email: typed,
          confirmedAdult: true,
          acceptedPrivacyPolicy: true,
          nickname: 'Jan',
        })
        .expect(400);

      expect(denialLines()).toEqual([
        `validation 400 POST /auth/register user=- req=${requestIdOf(response)} fields=email,nickname`,
      ]);
      const lines = JSON.stringify(warned.mock.calls);
      expect(lines).not.toContain(typed);
      expect(lines).not.toContain('Jan');
    });

    it('only counts a key outside the DTO that is shaped like an address', async () => {
      const address = newAddress();

      const response = await http()
        .post('/auth/register')
        .send({
          email: newAddress(),
          confirmedAdult: true,
          acceptedPrivacyPolicy: true,
          [address]: 1,
        })
        .expect(400);

      expect(denialLines()).toEqual([
        `validation 400 POST /auth/register user=- req=${requestIdOf(response)} unknown=1`,
      ]);
      expect(JSON.stringify(warned.mock.calls)).not.toContain(address);
    });
  });

  describe('roles', () => {
    it('logs a plain user on an admin route with the actor, without the search query', async () => {
      const user = await account();
      const fragment = user.address.slice(0, 12);

      const response = await searchUsers(user.cookie, { q: fragment }).expect(
        403,
      );

      expect(denialLines()).toEqual([
        `role_missing 403 GET /admin/users user=${user.id} req=${requestIdOf(response)} actor=${user.id}`,
      ]);
      expect(JSON.stringify(warned.mock.calls)).not.toContain(fragment);
    });

    it('logs an admin blocking another admin as a rank refusal', async () => {
      const admin = await account([RoleCode.ADMIN]);
      const otherAdmin = await account([RoleCode.ADMIN]);

      const response = await postAction(
        admin.cookie,
        otherAdmin.id,
        'block',
      ).expect(403);

      expect(denialLines()).toEqual([
        `admin_cannot_manage 403 POST /admin/users/:id/block user=${admin.id} req=${requestIdOf(response)} actor=${admin.id} target=${otherAdmin.id} action=block why=rank`,
      ]);
      const lines = JSON.stringify(warned.mock.calls);
      expect(lines).not.toContain(admin.address);
      expect(lines).not.toContain(otherAdmin.address);
    });

    it('logs an admin acting on their own account as a self refusal', async () => {
      const admin = await account([RoleCode.ADMIN]);

      const response = await postAction(
        admin.cookie,
        admin.id,
        'reset-sessions',
      ).expect(403);

      expect(denialLines()).toEqual([
        `admin_cannot_manage 403 POST /admin/users/:id/reset-sessions user=${admin.id} req=${requestIdOf(response)} actor=${admin.id} target=${admin.id} action=reset_sessions why=self`,
      ]);
    });
  });
});
