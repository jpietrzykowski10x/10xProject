import { daysFromToday, parseDateOnly, parseDayMonthYear, toDateOnly } from './date-only';

// The oracle is the Polish calendar: a day is typed as d.m.rrrr, months have their real lengths
// (29 February only in a leap year), and the API takes and gives the calendar day as YYYY-MM-DD with
// no time zone. Dates are checked through their local parts, never toISOString(): the suite runs in
// Europe/Warsaw and America/New_York, where the UTC day differs from the local one.

// [year, month 1-12, day, hours, minutes] of a local Date.
function localParts(date: Date | null): number[] | null {
  return date === null
    ? null
    : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
}

describe('parseDayMonthYear', () => {
  it.each([
    ['5.1.2026', [2026, 1, 5, 0, 0]],
    ['05.01.2026', [2026, 1, 5, 0, 0]],
    [' 05.01.2026 ', [2026, 1, 5, 0, 0]],
    ['31.12.2026', [2026, 12, 31, 0, 0]],
    ['1.1.2027', [2027, 1, 1, 0, 0]],
    // 2028 is a leap year.
    ['29.02.2028', [2028, 2, 29, 0, 0]],
    // The days DST starts in Europe and in the USA: still midnight, still that day.
    ['29.03.2026', [2026, 3, 29, 0, 0]],
    ['8.3.2026', [2026, 3, 8, 0, 0]],
  ])('reads %j as local midnight of %j', (value, expected) => {
    expect(localParts(parseDayMonthYear(value))).toEqual(expected);
  });

  it.each([
    // 2027 is not a leap year.
    '29.02.2027',
    '31.02.2027',
    // April has 30 days.
    '31.04.2026',
    '0.01.2026',
    '1.0.2026',
    '1.13.2026',
    '32.01.2026',
    '2026-01-05',
    '5/1/2026',
    '5.1.26',
    '5.1',
    '',
    'abc',
  ])('rejects %j', (value) => {
    expect(parseDayMonthYear(value)).toBeNull();
  });
});

describe('toDateOnly', () => {
  it.each([
    [new Date(2026, 0, 5), '2026-01-05'],
    [new Date(2026, 0, 5, 23, 30), '2026-01-05'],
    // Local midnight of New Year: the UTC day is still 31 December east of Greenwich.
    [new Date(2027, 0, 1), '2027-01-01'],
    // Late evening of New Year's Eve: the UTC day is already 1 January west of Greenwich.
    [new Date(2026, 11, 31, 23, 30), '2026-12-31'],
    [new Date(2027, 1, 28), '2027-02-28'],
    [new Date(2026, 10, 15), '2026-11-15'],
  ])('writes %s as %j', (date, expected) => {
    expect(toDateOnly(date)).toBe(expected);
  });
});

describe('parseDateOnly', () => {
  it.each([
    ['2026-11-15', [2026, 11, 15, 0, 0]],
    ['2027-01-01', [2027, 1, 1, 0, 0]],
    ['2028-02-29', [2028, 2, 29, 0, 0]],
  ])('reads %j as local midnight of %j', (value, expected) => {
    expect(localParts(parseDateOnly(value))).toEqual(expected);
  });

  it.each(['', '15.11.2026', '2026-1-5', '2026-11-15T00:00:00Z', '20261115', ' 2026-11-15'])(
    'rejects %j',
    (value) => {
      expect(parseDateOnly(value)).toBeNull();
    },
  );
});

describe('a typed day sent to the API', () => {
  it.each([
    ['5.1.2027', '2027-01-05'],
    ['05.01.2027', '2027-01-05'],
    ['1.1.2027', '2027-01-01'],
    ['31.12.2026', '2026-12-31'],
    ['29.02.2028', '2028-02-29'],
  ])('keeps %j as %j', (typed, expected) => {
    const day = parseDayMonthYear(typed);
    expect(day).not.toBeNull();
    expect(day === null ? null : toDateOnly(day)).toBe(expected);
  });

  it.each(['2026-11-15', '2027-01-01', '2028-02-29'])(
    'reads %j from the API and writes it back unchanged',
    (value) => {
      const day = parseDateOnly(value);
      expect(day === null ? null : toDateOnly(day)).toBe(value);
    },
  );
});

describe('daysFromToday', () => {
  it.each([
    ['2026-11-13', new Date(2026, 10, 13), 0],
    ['2026-11-13', new Date(2026, 10, 13, 23, 59), 0],
    ['2026-11-14', new Date(2026, 10, 13), 1],
    ['2026-11-14', new Date(2026, 10, 13, 23, 59), 1],
    ['2026-11-12', new Date(2026, 10, 13), -1],
    // November has 30 days.
    ['2026-12-13', new Date(2026, 10, 13), 30],
    ['2027-01-01', new Date(2026, 11, 31, 23, 30), 1],
    // DST starts in Europe on 29 March 2026 and in the USA on 8 March 2026: the night is an hour
    // shorter, but it is still one day.
    ['2026-03-29', new Date(2026, 2, 28), 1],
    ['2026-03-30', new Date(2026, 2, 29), 1],
    ['2026-03-08', new Date(2026, 2, 7), 1],
    ['2026-03-09', new Date(2026, 2, 8), 1],
    // DST ends in Europe on 25 October 2026 and in the USA on 1 November 2026: a longer night.
    ['2026-10-26', new Date(2026, 9, 25), 1],
    ['2026-11-02', new Date(2026, 10, 1), 1],
  ])('counts %j from %s as %i', (value, today, expected) => {
    expect(daysFromToday(value, today)).toBe(expected);
  });

  it.each(['', '13.11.2026', '2026-11-1'])('returns null for %j', (value) => {
    expect(daysFromToday(value, new Date(2026, 10, 13))).toBeNull();
  });
});
