import {
  addMonthsClamped,
  APP_TIME_ZONE,
  calendarDayIn,
} from './calendar-day.js';

describe('calendarDayIn', () => {
  it('uses Warsaw as the application time zone', () => {
    expect(APP_TIME_ZONE).toBe('Europe/Warsaw');
  });

  // Oracle: Warsaw is UTC+1 in winter (CET) and UTC+2 in summer (CEST); in 2026 summer time starts
  // on 29 March at 01:00 UTC and ends on 25 October at 01:00 UTC.
  it.each([
    // 00:30 CET, already the next day in Warsaw
    ['2026-03-28T23:30:00.000Z', '2026-03-29'],
    // 23:59 CET, still the same day
    ['2026-03-28T22:59:00.000Z', '2026-03-28'],
    // 23:59 CEST on the day summer time started
    ['2026-03-29T21:59:00.000Z', '2026-03-29'],
    // 00:00 CEST, the day after
    ['2026-03-29T22:00:00.000Z', '2026-03-30'],
    // 23:59 CEST, the eve of the change back
    ['2026-10-24T21:59:00.000Z', '2026-10-24'],
    // 00:00 CEST on the day summer time ends
    ['2026-10-24T22:00:00.000Z', '2026-10-25'],
    // 23:59 CET on that day
    ['2026-10-25T22:59:00.000Z', '2026-10-25'],
    // 00:00 CET, the day after
    ['2026-10-25T23:00:00.000Z', '2026-10-26'],
    // 00:30 CET on New Year's Day
    ['2026-12-31T23:30:00.000Z', '2027-01-01'],
  ])('puts %s on %s in Warsaw', (moment, day) => {
    expect(calendarDayIn(APP_TIME_ZONE, new Date(moment))).toBe(day);
  });

  // The zone comes from the argument, not from the process: the same moment is another day
  // elsewhere.
  it.each([
    ['UTC', '2026-03-28'],
    ['America/New_York', '2026-03-28'],
    ['Asia/Tokyo', '2026-03-29'],
  ])('puts 2026-03-28T23:30Z on the day of the %s zone', (timeZone, day) => {
    expect(calendarDayIn(timeZone, new Date('2026-03-28T23:30:00.000Z'))).toBe(
      day,
    );
  });
});

describe('addMonthsClamped', () => {
  // Oracle: the calendar (days in a month, leap years).
  it.each([
    // no change
    ['2026-03-31', 0, '2026-03-31'],
    ['2026-11-19', 1, '2026-12-19'],
    // across the year
    ['2026-12-15', 1, '2027-01-15'],
    // February has 28 days in 2026
    ['2026-01-31', 1, '2026-02-28'],
    // and 29 in a leap year
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-01-31', 10, '2026-11-30'],
    // a leap day a year later
    ['2028-02-29', 12, '2029-02-28'],
    ['2024-03-10', 36, '2027-03-10'],
    // backwards
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-01-15', -1, '2025-12-15'],
  ])('moves %s by %i months to %s', (day, months, expected) => {
    expect(addMonthsClamped(day, months)).toBe(expected);
  });

  it.each([
    ['2026-02-31', 1],
    ['2026-1-31', 1],
    ['', 1],
    ['2026-01-31', 1.5],
  ])('refuses %j + %d', (day, months) => {
    expect(() => addMonthsClamped(day, months)).toThrow();
  });
});
