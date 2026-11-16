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
