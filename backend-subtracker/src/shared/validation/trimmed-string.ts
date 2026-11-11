import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

// Trimming runs before validation, so a value of spaces alone is empty and refused.
// NFC makes a letter typed as one code point or as base + combining mark the same string, so the
// stored value and anything derived from it (e.g. a name key) agree; the length counts that form.
export const TrimmedString = (maxLength: number) =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().normalize('NFC') : value,
    ),
    IsString(),
    Length(1, maxLength),
  );
