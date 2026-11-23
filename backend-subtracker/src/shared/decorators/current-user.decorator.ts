import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../types/auth-user.js';

// The guard attaches the user to every protected route. No user here means the parameter sits on
// a @Public() route: a mistake in the route, not an expired session, so a plain Error (500 with a
// line in the log) instead of a 401 the frontend would turn into a silent sign-out.
export function currentUserOf(context: ExecutionContext): AuthUser {
  const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (user === undefined) {
    throw new Error('CurrentUser used on a route without a session user');
  }
  return user;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    currentUserOf(context),
);
