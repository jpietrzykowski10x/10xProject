import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../types/auth-user.js';

// On a @Public() route the guard attaches no user; refusing here keeps the AuthUser type honest.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user === undefined) {
      throw new UnauthorizedException();
    }
    return user;
  },
);
