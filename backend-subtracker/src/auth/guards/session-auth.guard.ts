import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../../shared/decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../../shared/types/auth-user.js';
import { SessionService } from '../services/session.service.js';

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
    const user = await this.sessions.authenticate(request);
    if (user === null) {
      throw new UnauthorizedException();
    }

    request.user = user;
    return true;
  }
}
