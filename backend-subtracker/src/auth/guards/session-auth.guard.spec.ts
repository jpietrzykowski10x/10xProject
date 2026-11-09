import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Repository } from 'typeorm';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import { Public } from '../../shared/decorators/public.decorator.js';
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
  return { guard, findOne };
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

  it('answers 401 without a Cookie header, without querying the database', async () => {
    const { guard, findOne } = setup();

    await expect(
      guard.canActivate(contextFor(requestWith())),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('answers 401 when the header has no session cookie', async () => {
    const { guard, findOne } = setup();

    await expect(
      guard.canActivate(contextFor(requestWith('other=value'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('answers 401 for an unknown token', async () => {
    const { guard } = setup(null);

    await expect(
      guard.canActivate(contextFor(requestWith(SESSION_COOKIE))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 401 for an expired session', async () => {
    const { guard } = setup(
      sessionWith({ expiresAt: new Date(Date.now() - 1) }),
    );

    await expect(
      guard.canActivate(contextFor(requestWith(SESSION_COOKIE))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 401 for a revoked session', async () => {
    const { guard } = setup(sessionWith({ revokedAt: new Date() }));

    await expect(
      guard.canActivate(contextFor(requestWith(SESSION_COOKIE))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 401 for an inactive user', async () => {
    const { guard } = setup(sessionWith({}, { isActive: false }));

    await expect(
      guard.canActivate(contextFor(requestWith(SESSION_COOKIE))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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
});
