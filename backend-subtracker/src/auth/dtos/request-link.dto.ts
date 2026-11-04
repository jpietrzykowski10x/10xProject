import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/services/users.service.js';

// Runs before validation, which would refuse spaces copied around an otherwise correct address.
// Validating the stored form matters too: lowercasing can lengthen an address past the column.
export const NormalizedEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  );

export class RequestLinkDto {
  @NormalizedEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;
}
