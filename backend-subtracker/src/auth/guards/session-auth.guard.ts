import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../../shared/decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../../shared/types/auth-user.js';
import type { Session } from '../entities/session.entity.js';
import { SessionService, toAuthUser } from '../services/session.service.js';

function isValid(session: Session): boolean {
  return (
    session.revokedAt === null &&
    session.expiresAt.getTime() > Date.now() &&
    session.user.isActive
  );
}

// Registered globally: every route requires a session unless it carries @Public().
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic: true | undefined = this.reflector.getAllAndOverride(
      Public,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.sessions.readToken(request);
    if (token === undefined) {
      throw new UnauthorizedException();
    }

    const session = await this.sessions.findByToken(token);
    if (session === null || !isValid(session)) {
      throw new UnauthorizedException();
    }

    request.user = toAuthUser(session.user);
    return true;
  }
}
