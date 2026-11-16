import { isDateOnly } from '../validation/date-only.js';

// The time zone of the application's "today" (jobs, schedules). Named explicitly, so the result
// never depends on the time zone of the process or of the database session.
export const APP_TIME_ZONE = 'Europe/Warsaw';

// The calendar day (YYYY-MM-DD) that the moment falls on in the time zone.
export function calendarDayIn(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((entry) => entry.type === type)?.value;
    if (value === undefined) {
      throw new Error(`No ${type} in the formatted date`);
    }
    return value;
  };
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

// The day N months later (or earlier, for a negative N); a day the target month does not have
// becomes its last day (2026-01-31 + 1 → 2026-02-28).
export function addMonthsClamped(day: string, months: number): string {
  if (!isDateOnly(day)) {
    throw new Error(`Not a YYYY-MM-DD day: ${JSON.stringify(day)}`);
  }
  if (!Number.isInteger(months)) {
    throw new Error(`Not a whole number of months: ${months}`);
  }
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const monthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex - targetYear * 12; // 0–11
  // Day 0 of the next month is the last day of the target month.
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  return [
    String(targetYear).padStart(4, '0'),
    String(targetMonth + 1).padStart(2, '0'),
    String(Math.min(dayOfMonth, lastDay)).padStart(2, '0'),
  ].join('-');
}

// The UTC midnight of a YYYY-MM-DD day as milliseconds; refuses anything that is not a real day.
function utcMidnightOf(day: string): number {
  if (!isDateOnly(day)) {
    throw new Error(`Not a YYYY-MM-DD day: ${JSON.stringify(day)}`);
  }
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, dayOfMonth);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The day N days later (or earlier, for a negative N). Counted on UTC, where every day has 24
// hours, so a daylight saving change in the process's time zone cannot shift it.
export function addDays(day: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error(`Not a whole number of days: ${days}`);
  }
  return new Date(utcMidnightOf(day) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// A YYYY-MM-DD day in the Polish notation, DD.MM.YYYY (e.g. in a mail); refuses anything else.
export function formatPolishDate(day: string): string {
  if (!isDateOnly(day)) {
    throw new Error(`Not a YYYY-MM-DD day: ${JSON.stringify(day)}`);
  }
  const [year, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}.${month}.${year}`;
}

// The number of calendar days from one day to another (negative when `to` is earlier).
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnightOf(to) - utcMidnightOf(from)) / DAY_MS);
}
