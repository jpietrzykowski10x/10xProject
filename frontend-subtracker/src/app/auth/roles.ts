import type { AuthUser } from './auth.service';

// Role codes as GET /auth/session sends them (backend RoleCode).
export const ADMIN_ROLES: readonly string[] = ['ADMIN', 'SUPER_ADMIN'];

// Admin pages and the "Administracja" link are for administrators and the superadministrator.
export function isAdmin(user: AuthUser | null | undefined): boolean {
  return user?.roles.some((role) => ADMIN_ROLES.includes(role)) ?? false;
}
