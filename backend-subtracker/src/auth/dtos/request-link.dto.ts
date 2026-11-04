import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';

// Normalizing runs before validation, which would refuse spaces copied around an otherwise correct
// address, and validates the stored form: lowercasing can lengthen an address past the column.
// Quoted local parts are valid by the RFC, but with a line break in them the stored address and
// the one the mail goes to differ.
export const ValidEmail = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeEmail(value) : value,
    ),
    IsEmail(),
    MaxLength(EMAIL_MAX_LENGTH),
    Matches(/^[^"]*$/),
  );

export class RequestLinkDto {
  @ValidEmail()
  email: string;
}
