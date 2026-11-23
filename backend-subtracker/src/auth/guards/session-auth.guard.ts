import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../../shared/decorators/public.decorator.js';
import { withDenial } from '../../shared/logging/denial.js';
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
    const result = await this.sessions.check(request);
    if ('reason' in result) {
      throw withDenial(new UnauthorizedException(), {
        code: result.reason,
        ids:
          result.sessionId === undefined
            ? undefined
            : { session: result.sessionId },
      });
    }

    request.user = result.user;
    return true;
  }
}
