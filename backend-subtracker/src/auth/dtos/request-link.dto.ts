import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

// The length of user.email: a longer address would fail at the database instead of validation.
export const EMAIL_MAX_LENGTH = 254;

// Runs before validation, which would refuse spaces copied around an otherwise correct address.
export const TrimEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export class RequestLinkDto {
  @TrimEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;
}
