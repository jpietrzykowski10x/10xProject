// Calendar days from the API ("2026-11-15"), without a time zone. Never `new Date('2026-11-15')`:
// that is midnight UTC and shows the previous day west of Greenwich.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The day as a local Date at midnight, or null for a value that is not YYYY-MM-DD.
export function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (match === null) {
    return null;
  }
  const [, year, month, day] = match;
  return new Date(+year, +month - 1, +day);
}

// Whole days from the local today to the given day: 0 today, 1 tomorrow, negative in the past.
// Both days are reduced to their date parts and compared as UTC midnights, so a DST change in
// between cannot make a day 23 or 25 hours long.
export function daysFromToday(value: string, today: Date = new Date()): number | null {
  const day = parseDateOnly(value);
  if (day === null) {
    return null;
  }
  const target = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / MS_PER_DAY);
}

// The local calendar day of a Date as YYYY-MM-DD, for the API. Never `toISOString()`: that is the
// UTC day, one day earlier for a local midnight east of Greenwich.
export function toDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${month}-${day}`;
}

const DAY_MONTH_YEAR = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

// A day typed the Polish way ("05.01.2026" or "5.1.2026") as a local Date at midnight, or null for
// any other text or a day that does not exist ("31.02.2026" would otherwise roll over to March).
export function parseDayMonthYear(value: string): Date | null {
  const match = DAY_MONTH_YEAR.exec(value.trim());
  if (match === null) {
    return null;
  }
  const [year, month, day] = [+match[3], +match[2] - 1, +match[1]];
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}
