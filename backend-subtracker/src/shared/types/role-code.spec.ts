import { RoleCode, ROLE_DEFINITIONS, roleIdOf } from './role-code.js';

describe('roleIdOf', () => {
  it('returns the fixed id of every role code', () => {
    for (const code of Object.values(RoleCode)) {
      expect(roleIdOf(code)).toBe(
        ROLE_DEFINITIONS.find((role) => role.code === code)?.id,
      );
    }
  });

  it('gives every role its own id', () => {
    const ids = Object.values(RoleCode).map(roleIdOf);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
