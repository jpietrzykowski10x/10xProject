import { Logger } from '@nestjs/common';
import { AuthService } from '../../src/auth/services/auth.service.js';
import { createE2eApp } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

describe('Auth flow — unexpected errors (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-errors-' });
  const { http, newAddress } = e2e;
  const { postRequestLink } = authRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

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
      vi.spyOn(e2e.app.get(AuthService), 'requestLink').mockRejectedValue(
        failure,
      );
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

    it('keeps the status of a body parser error and does not log it', async () => {
      const logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await http()
        .post('/auth/request-link')
        .send({ email: 'a'.repeat(200 * 1024) })
        .expect(413);

      expect(logged).not.toHaveBeenCalled();
    });
  });
});
