import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../types/auth-user.js';
import type { RoleCode } from '../types/role-code.js';

// Runs after the session guard and only reads request.user: it neither authenticates again nor
// queries the database.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required: RoleCode[] | undefined = this.reflector.getAllAndOverride(
      Roles,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!required.some((role) => user?.roles.includes(role))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
