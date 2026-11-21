export enum RoleCode {
  USER = 'USER',
  ADMIN = 'ADMIN',
  // At most one account holds it: grantRole refuses a second one and the partial unique index
  // SINGLE_SUPER_ADMIN_INDEX on user_role rejects it even for a hand-written INSERT.
  SUPER_ADMIN = 'SUPER_ADMIN',
}

// The only place in code that holds the role ids. The dev database gets these rows from
// RolesSeeder; the seed migrations spell the same values out literally.
export const ROLE_DEFINITIONS = [
  {
    id: 'c23edba1-52ef-4dd4-8608-3d95b16af950',
    code: RoleCode.USER,
    name: 'Użytkownik',
  },
  {
    id: 'aa77833c-3a6d-43f7-8428-97aab95e25f2',
    code: RoleCode.ADMIN,
    name: 'Administrator',
  },
  {
    id: 'ab11313f-1fa6-49eb-9770-227cf6a29d02',
    code: RoleCode.SUPER_ADMIN,
    name: 'Superadministrator',
  },
];

// The fixed id of a role, e.g. for SQL that cannot look the role up by code (an index predicate).
export function roleIdOf(code: RoleCode): string {
  const definition = ROLE_DEFINITIONS.find((role) => role.code === code);
  if (definition === undefined) {
    throw new Error(`ROLE_DEFINITIONS has no ${code} role`);
  }
  return definition.id;
}
