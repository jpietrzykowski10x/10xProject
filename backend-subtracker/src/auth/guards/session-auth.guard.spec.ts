import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Repository } from 'typeorm';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import { Public } from '../../shared/decorators/public.decorator.js';
import { denialOf } from '../../shared/logging/denial.js';
import type { AuthenticatedRequest } from '../../shared/types/auth-user.js';
import { RoleCode } from '../../shared/types/role-code.js';
import type { Role } from '../../users/entities/role.entity.js';
import type { UserRole } from '../../users/entities/user-role.entity.js';
import type { User } from '../../users/entities/user.entity.js';
import { SESSION_COOKIE_NAME } from '../auth.constants.js';
import type { Session } from '../entities/session.entity.js';
import { hashToken, SessionService } from '../services/session.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';

const TOKEN = 'token-z-ciasteczka';
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=${TOKEN}`;
const HOUR_MS = 60 * 60 * 1000;
const SESSION_ID = 'session-1';

class Routes {
  guarded(): void {}

  @Public()
  open(): void {}
}

function configStub() {
  const env = validateEnv({
    MODE: 'DEV',
    POSTGRES_HOST: 'localhost',
    POSTGRES_USER: 'subtracker-adm',
    POSTGRES_PASSWORD: 'secret',
    POSTGRES_DATABASE: 'subtracker-db',
    POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
    CORS_ORIGINS: 'http://localhost:4200',
  });
  return {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>;
}

function grant(code: RoleCode, isActive = true): UserRole {
  return { role: { code, isActive } as Role } as UserRole;
}

function sessionWith(
  overrides: Partial<Session> = {},
  user: Partial<User> = {},
): Session {
  return {
    id: SESSION_ID,
    revokedAt: null,
    expiresAt: new Date(Date.now() + HOUR_MS),
    user: {
      id: 'user-1',
      email: 'jan@example.com',
      isActive: true,
      userRoles: [grant(RoleCode.USER)],
      ...user,
    },
    ...overrides,
  } as Session;
}

function setup(session: Session | null = null) {
  const findOne = vi.fn(() => Promise.resolve(session));
  const service = new SessionService(
    { findOne } as unknown as Repository<Session>,
    configStub(),
  );
  const guard = new SessionAuthGuard(new Reflector(), service);
  return { guard, service, findOne };
}

function requestWith(cookie?: string): AuthenticatedRequest {
  return { headers: { cookie } } as unknown as AuthenticatedRequest;
}

function contextFor(
  request: AuthenticatedRequest,
  handler: () => void = Routes.prototype.guarded,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  it('lets a @Public() route through without a cookie', async () => {
    const { guard, findOne } = setup();

    await expect(
      guard.canActivate(contextFor(requestWith(), Routes.prototype.open)),
    ).resolves.toBe(true);
    expect(findOne).not.toHaveBeenCalled();
  });

  // The refusal the guard throws: always 401, with the reason for the log line.
  async function refusalOf(
    session: Session | null,
    cookie: string | undefined = SESSION_COOKIE,
  ): Promise<unknown> {
    const { guard } = setup(session);
    const error = await guard
      .canActivate(contextFor(requestWith(cookie)))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthorizedException);
    return error;
  }

  it('answers 401 session_missing without a Cookie header, without querying the database', async () => {
    const { guard, findOne } = setup();

    const error = await guard
      .canActivate(contextFor(requestWith()))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(denialOf(error)).toEqual({
      code: 'session_missing',
      ids: undefined,
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('answers 401 session_missing when the header has no session cookie', async () => {
    const { guard, findOne } = setup();

    const error = await guard
      .canActivate(contextFor(requestWith('other=value')))
      .catch((caught: unknown) => caught);

    expect(denialOf(error)).toEqual({
      code: 'session_missing',
      ids: undefined,
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('answers 401 session_unknown for an unknown token, without ids', async () => {
    const error = await refusalOf(null);

    expect(denialOf(error)).toEqual({
      code: 'session_unknown',
      ids: undefined,
    });
  });

  it('answers 401 session_expired for an expired session, with its id', async () => {
    const error = await refusalOf(
      sessionWith({ expiresAt: new Date(Date.now() - 1) }),
    );

    expect(denialOf(error)).toEqual({
      code: 'session_expired',
      ids: { session: SESSION_ID },
    });
  });

  it('answers 401 session_revoked for a revoked session, with its id', async () => {
    const error = await refusalOf(sessionWith({ revokedAt: new Date() }));

    expect(denialOf(error)).toEqual({
      code: 'session_revoked',
      ids: { session: SESSION_ID },
    });
  });

  it('answers 401 session_inactive for an inactive user, with the session id', async () => {
    const error = await refusalOf(sessionWith({}, { isActive: false }));

    expect(denialOf(error)).toEqual({
      code: 'session_inactive',
      ids: { session: SESSION_ID },
    });
  });

  it('checks revoked before expired before an inactive account', async () => {
    const past = new Date(Date.now() - 1);

    const all = await refusalOf(
      sessionWith({ revokedAt: past, expiresAt: past }, { isActive: false }),
    );
    const expiredAndInactive = await refusalOf(
      sessionWith({ expiresAt: past }, { isActive: false }),
    );

    expect(denialOf(all)?.code).toBe('session_revoked');
    expect(denialOf(expiredAndInactive)?.code).toBe('session_expired');
  });

  it('looks the session up by the token hash and attaches request.user', async () => {
    const { guard, findOne } = setup(sessionWith());
    const request = requestWith(`other=value; ${SESSION_COOKIE}`);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken(TOKEN) } }),
    );
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'jan@example.com',
      roles: [RoleCode.USER],
    });
  });

  it('does not count inactive roles', async () => {
    const { guard } = setup(
      sessionWith(
        {},
        { userRoles: [grant(RoleCode.USER), grant(RoleCode.ADMIN, false)] },
      ),
    );
    const request = requestWith(SESSION_COOKIE);

    await guard.canActivate(contextFor(request));

    expect(request.user?.roles).toEqual([RoleCode.USER]);
  });

  // What GET /auth/session relies on: a refused session is null, not an error.
  it('authenticate gives the user of a valid session and null for any refusal', async () => {
    const valid = setup(sessionWith()).service;
    const revoked = setup(sessionWith({ revokedAt: new Date() })).service;
    const unknown = setup(null).service;

    await expect(
      valid.authenticate(requestWith(SESSION_COOKIE)),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'jan@example.com',
      roles: [RoleCode.USER],
    });
    await expect(
      revoked.authenticate(requestWith(SESSION_COOKIE)),
    ).resolves.toBeNull();
    await expect(
      unknown.authenticate(requestWith(SESSION_COOKIE)),
    ).resolves.toBeNull();
    await expect(unknown.authenticate(requestWith())).resolves.toBeNull();
  });
});
