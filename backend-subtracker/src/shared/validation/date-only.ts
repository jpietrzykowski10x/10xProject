import { ValidateBy, type ValidationArguments } from 'class-validator';

const DATE_ONLY = /^([1-9]\d{3})-(\d{2})-(\d{2})$/;

// A calendar day as YYYY-MM-DD that exists (no 2026-02-31). Being strings of the same shape,
// two such days compare correctly as text.
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = DATE_ONLY.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// For a `date` column, which TypeORM reads and writes as the same YYYY-MM-DD string.
export const IsDateOnly = () =>
  ValidateBy({
    name: 'isDateOnly',
    validator: {
      validate: (value: unknown) => isDateOnly(value),
      defaultMessage: (args?: ValidationArguments) =>
        `${args?.property ?? 'value'} must be a date in the YYYY-MM-DD format`,
    },
  });
