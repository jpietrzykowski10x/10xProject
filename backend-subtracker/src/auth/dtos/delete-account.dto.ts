import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';

// Only a confirmation: the account's own address, compared after the same normalization as the
// stored one. Any other string is refused by the comparison, so no address format check here.
export class DeleteAccountDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;
}
