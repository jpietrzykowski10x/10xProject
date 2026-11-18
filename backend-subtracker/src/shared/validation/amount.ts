import { applyDecorators } from '@nestjs/common';
import { IsNumber, Max, Min } from 'class-validator';

// An amount in PLN sent as a JSON number (never a string): at most two decimals, from 0 up to
// `max`. Meant for a numeric(10,2) column written with toFixed(2).
export const IsAmount = (max: number) =>
  applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }),
    Min(0),
    Max(max),
  );
