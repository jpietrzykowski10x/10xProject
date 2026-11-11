import { isDateOnly } from './date-only.js';

describe('isDateOnly', () => {
  it.each(['2026-11-15', '2028-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isDateOnly(value)).toBe(true);
  });

  it.each(['2026-13-01', '2027-02-29', '0000-01-01', '2026-1-5', 20261115])(
    'refuses %s',
    (value) => {
      expect(isDateOnly(value)).toBe(false);
    },
  );
});
