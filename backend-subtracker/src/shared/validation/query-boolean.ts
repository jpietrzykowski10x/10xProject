import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

// An optional boolean in the query string. Only the words `true` and `false` count; anything else
// (`1`, `yes`, a repeated parameter) stays as it came and is refused by IsBoolean, rather than
// turned into true the way Boolean('false') would.
export const QueryBoolean = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => {
      if (value === 'true') {
        return true;
      }
      return value === 'false' ? false : value;
    }),
    IsOptional(),
    IsBoolean(),
  );
