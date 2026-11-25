// Whether a value is a UUID the API's @IsUUID() takes (class-validator's default `all`: versions 1
// to 8 with the RFC variant, plus the nil and the max UUID), in any letter case. Checked before a
// value from the address goes into a request, so a mistyped link does not end in a 400.
const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
