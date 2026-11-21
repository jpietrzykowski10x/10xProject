import { RoleCode } from '../shared/types/role-code.js';

export type AdminRank = 0 | 1 | 2;

// The role the admin API shows. SUPER_ADMIN is shown as 'admin', so the API never tells another
// account who the superadmin is; it only shows up as an admin nobody can manage.
export type VisibleRole = 'user' | 'admin';

export interface RankedAccount {
  id: string;
  // Active roles only, as in AuthUser.
  roles: readonly RoleCode[];
}

export function rankOf(roles: readonly RoleCode[]): AdminRank {
  if (roles.includes(RoleCode.SUPER_ADMIN)) {
    return 2;
  }
  return roles.includes(RoleCode.ADMIN) ? 1 : 0;
}

// One rule for every decision: nobody manages themselves, an admin manages only plain users, the
// superadmin also admins, and nobody manages the superadmin.
export function canManage(
  actor: RankedAccount,
  target: RankedAccount,
): boolean {
  return actor.id !== target.id && rankOf(actor.roles) > rankOf(target.roles);
}

export function visibleRole(roles: readonly RoleCode[]): VisibleRole {
  return rankOf(roles) > 0 ? 'admin' : 'user';
}
