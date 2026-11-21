import { Transform } from 'class-transformer';
import { IsString, Length, ValidateIf } from 'class-validator';
import { QueryBoolean } from '../../shared/validation/query-boolean.js';
import { EMAIL_MAX_LENGTH } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';
import { ADMIN_SEARCH_MIN_LENGTH } from '../admin-user.types.js';

// GET /admin/users?q=&blocked=. The fragment is folded like a stored address (trimmed, lower
// case). It is required unless the request lists the blocked accounts; there an empty one counts
// as missing.
export class SearchUsersDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @ValidateIf(
    (dto: SearchUsersDto) =>
      dto.blocked !== true || (dto.q !== undefined && dto.q !== ''),
  )
  @IsString()
  @Length(ADMIN_SEARCH_MIN_LENGTH, EMAIL_MAX_LENGTH)
  q?: string;

  @QueryBoolean()
  blocked?: boolean;
}
