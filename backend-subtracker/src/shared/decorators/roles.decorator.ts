import { Reflector } from '@nestjs/core';
import type { RoleCode } from '../types/role-code.js';

export const ROLES_METADATA_KEY = 'auth:roles';

// @Roles(RoleCode.ADMIN) or @Roles([RoleCode.USER, RoleCode.ADMIN]): any listed role is enough.
export const Roles = Reflector.createDecorator<
  RoleCode | RoleCode[],
  RoleCode[]
>({
  key: ROLES_METADATA_KEY,
  transform: (roles) => [roles].flat(),
});
