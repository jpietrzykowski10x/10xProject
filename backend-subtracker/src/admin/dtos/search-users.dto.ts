import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';
import {
  ADMIN_SEARCH_MIN_LENGTH,
  AdminStatusFilter,
} from '../admin-user.types.js';

// GET /admin/users?q=&status=. The fragment is folded like a stored address (trimmed, lower
// case). It is required unless the request lists the blocked accounts; there an empty one counts
// as missing.
export class SearchUsersDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @ValidateIf(
    (dto: SearchUsersDto) =>
      dto.status !== AdminStatusFilter.BLOCKED ||
      (dto.q !== undefined && dto.q !== ''),
  )
  @IsString()
  @Length(ADMIN_SEARCH_MIN_LENGTH, EMAIL_MAX_LENGTH)
  q?: string;

  @IsOptional()
  @IsEnum(AdminStatusFilter)
  status: AdminStatusFilter = AdminStatusFilter.ALL;
}
