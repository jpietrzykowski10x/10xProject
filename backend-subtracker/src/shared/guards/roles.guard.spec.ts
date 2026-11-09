import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator.js';
import type { AuthUser } from '../types/auth-user.js';
import { RoleCode } from '../types/role-code.js';
import { RolesGuard } from './roles.guard.js';

class Routes {
  open(): void {}

  @Roles(RoleCode.ADMIN)
  adminOnly(): void {}

  @Roles([RoleCode.USER, RoleCode.ADMIN])
  anyRole(): void {}
}

@Roles(RoleCode.ADMIN)
class AdminRoutes {
  inherited(): void {}

  @Roles(RoleCode.USER)
  overridden(): void {}
}

function contextFor(
  handler: () => void,
  owner: abstract new () => unknown,
  user?: AuthUser,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => owner,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function userWith(...roles: RoleCode[]): AuthUser {
  return { id: 'user-1', email: 'jan@example.com', roles };
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const routes = Routes.prototype;
  const adminRoutes = AdminRoutes.prototype;

  it('lets a route without metadata through, even without a user', () => {
    expect(guard.canActivate(contextFor(routes.open, Routes))).toBe(true);
  });

  it('lets a user with the required role through', () => {
    const context = contextFor(
      routes.adminOnly,
      Routes,
      userWith(RoleCode.USER, RoleCode.ADMIN),
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('accepts any one of the listed roles', () => {
    const context = contextFor(routes.anyRole, Routes, userWith(RoleCode.USER));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('answers 403 when the user lacks the role', () => {
    const context = contextFor(
      routes.adminOnly,
      Routes,
      userWith(RoleCode.USER),
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('answers 403 when a guarded route has no user', () => {
    const context = contextFor(routes.adminOnly, Routes);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('reads class metadata, and the method overrides it', () => {
    const user = userWith(RoleCode.USER);

    expect(() =>
      guard.canActivate(contextFor(adminRoutes.inherited, AdminRoutes, user)),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(contextFor(adminRoutes.overridden, AdminRoutes, user)),
    ).toBe(true);
  });
});
