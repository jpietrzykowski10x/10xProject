import { isUuid } from './uuid';

// The oracle is class-validator's isUUID with its default version `all` (validator.js isUUID), the
// check behind @IsUUID() in the API's query DTOs.
describe('isUuid', () => {
  it.each([
    ['a version 4 UUID', '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0c3a'],
    ['a version 7 UUID', '01890a5d-ac96-774b-bcce-b302099a8057'],
    ['upper case letters', '3F2B8C1E-9D4A-4F6B-8A2C-1E5D7F9B0C3A'],
    ['the nil UUID', '00000000-0000-0000-0000-000000000000'],
    ['the max UUID', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
  ])('accepts %s', (_case, value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['a word', 'rozrywka'],
    ['no hyphens', '3f2b8c1e9d4a4f6b8a2c1e5d7f9b0c3a'],
    ['version 0', '3f2b8c1e-9d4a-0f6b-8a2c-1e5d7f9b0c3a'],
    ['version 9', '3f2b8c1e-9d4a-9f6b-8a2c-1e5d7f9b0c3a'],
    ['a variant outside 8, 9, a, b', '3f2b8c1e-9d4a-4f6b-ca2c-1e5d7f9b0c3a'],
    ['a letter outside hex', '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0c3g'],
    ['a space around it', ' 3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0c3a'],
  ])('refuses %s', (_case, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
