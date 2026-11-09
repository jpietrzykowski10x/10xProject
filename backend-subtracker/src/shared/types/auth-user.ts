import type { Request } from 'express';
import type { RoleCode } from './role-code.js';

export interface AuthUser {
  id: string;
  email: string;
  roles: RoleCode[];
}

// `user` is set by the session guard, so it is absent on @Public() routes.
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
