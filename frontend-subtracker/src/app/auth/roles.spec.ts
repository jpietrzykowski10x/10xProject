import type { AuthUser } from './auth.service';
import { isAdmin } from './roles';

function user(roles: string[]): AuthUser {
  return { id: 'u1', email: 'anna@example.com', roles };
}

// The oracle is the access rule of S-09: the admin pages are for the ADMIN and SUPER_ADMIN roles.
describe('isAdmin', () => {
  it.each([
    [['ADMIN'], true],
    [['SUPER_ADMIN'], true],
    [['USER', 'ADMIN'], true],
    [['USER'], false],
    [[], false],
    [['admin'], false],
  ])('roles %j give %j', (roles, expected) => {
    expect(isAdmin(user(roles))).toBe(expected);
  });

  it('is false without a user', () => {
    expect(isAdmin(null)).toBe(false);
  });
});
