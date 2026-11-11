import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

// Trimming runs before validation, so a value of spaces alone is empty and refused.
export const TrimmedString = (maxLength: number) =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    Length(1, maxLength),
  );
