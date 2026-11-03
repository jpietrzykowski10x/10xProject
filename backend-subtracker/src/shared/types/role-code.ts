export enum RoleCode {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

// The only place in code that holds the role ids. The dev database gets these rows from
// RolesSeeder; the seed migration spells the same values out literally.
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
];
