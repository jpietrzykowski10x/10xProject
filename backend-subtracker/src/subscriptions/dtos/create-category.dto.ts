import { CATEGORY_NAME_MAX_LENGTH } from '../subscription.types.js';
import { TrimmedString } from '../../shared/validation/trimmed-string.js';

export class CreateCategoryDto {
  @TrimmedString(CATEGORY_NAME_MAX_LENGTH)
  name: string;
}
