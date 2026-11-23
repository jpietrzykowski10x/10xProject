import { type ExecutionContext, HttpException } from '@nestjs/common';
import type { AuthUser } from '../types/auth-user.js';
import { currentUserOf } from './current-user.decorator.js';

function contextWith(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser', () => {
  it('returns the user the session guard attached', () => {
    const user: AuthUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ktos@example.com',
      roles: [],
    };

    expect(currentUserOf(contextWith(user))).toBe(user);
  });

  it('throws a plain error, not an HTTP 401, on a route without a session user', () => {
    let thrown: unknown;
    try {
      currentUserOf(contextWith(undefined));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(HttpException);
    expect((thrown as Error).message).toBe(
      'CurrentUser used on a route without a session user',
    );
  });
});
