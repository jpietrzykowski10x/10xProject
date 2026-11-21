import { RoleCode } from '../shared/types/role-code.js';
import { canManage, rankOf, visibleRole } from './admin-rank.js';

const USER = [RoleCode.USER];
const ADMIN = [RoleCode.USER, RoleCode.ADMIN];
const SUPER_ADMIN = [RoleCode.USER, RoleCode.SUPER_ADMIN];

describe('rankOf', () => {
  it.each([
    ['no role', [], 0],
    ['USER', USER, 0],
    ['ADMIN', ADMIN, 1],
    ['SUPER_ADMIN', SUPER_ADMIN, 2],
    ['ADMIN and SUPER_ADMIN', [RoleCode.ADMIN, RoleCode.SUPER_ADMIN], 2],
  ])('ranks %s as %i', (_case, roles, rank) => {
    expect(rankOf(roles)).toBe(rank);
  });
});

describe('canManage', () => {
  const account = (id: string, roles: RoleCode[]) => ({ id, roles });

  it.each([
    ['a user', USER, 'another user', USER, false],
    ['a user', USER, 'an admin', ADMIN, false],
    ['a user', USER, 'the superadmin', SUPER_ADMIN, false],
    ['an admin', ADMIN, 'a user', USER, true],
    ['an admin', ADMIN, 'another admin', ADMIN, false],
    ['an admin', ADMIN, 'the superadmin', SUPER_ADMIN, false],
    ['the superadmin', SUPER_ADMIN, 'a user', USER, true],
    ['the superadmin', SUPER_ADMIN, 'an admin', ADMIN, true],
  ])(
    'lets %s manage %s: %s',
    (_actor, actorRoles, _target, targetRoles, expected) => {
      expect(
        canManage(account('actor', actorRoles), account('target', targetRoles)),
      ).toBe(expected);
    },
  );

  it.each([
    ['a user', USER],
    ['an admin', ADMIN],
    ['the superadmin', SUPER_ADMIN],
  ])('never lets %s manage their own account', (_case, roles) => {
    expect(canManage(account('same', roles), account('same', roles))).toBe(
      false,
    );
  });
});

describe('visibleRole', () => {
  it.each([
    ['no role', [], 'user'],
    ['USER', USER, 'user'],
    ['ADMIN', ADMIN, 'admin'],
    ['SUPER_ADMIN', SUPER_ADMIN, 'admin'],
  ])('shows %s as %s', (_case, roles, role) => {
    expect(visibleRole(roles)).toBe(role);
  });
});
