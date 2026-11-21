import type { AdminVisibleRole } from './admin.types';

export const ADMIN_ROLE_LABELS: Record<AdminVisibleRole, string> = {
  user: 'Użytkownik',
  admin: 'Administrator',
};

export function accountStatusLabel(isActive: boolean): string {
  return isActive ? 'Aktywne' : 'Zablokowane';
}
