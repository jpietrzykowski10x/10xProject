import { APP_TIME_ZONE } from '../date/calendar-day.js';

// The pieces of the API's log line format shared by the Nest logger (AppLogger) and the lines
// written before or outside it (the fatal handlers): the timestamp, the decision about colours,
// the background highlight of a whole message and the stack without a database error's text.

const ESC = '\x1b';
const RESET = `${ESC}[0m`;

export type HighlightStyle = 'success' | 'failure' | 'info' | 'notice';

const HIGHLIGHT_CODES: Readonly<Record<HighlightStyle, string>> = {
  success: '30;42', // black on green
  failure: '30;41', // black on red
  info: '44', // blue background
  notice: '46', // cyan background
};

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

// One formatter per time zone: building an Intl.DateTimeFormat costs far more than using it, and
// every log line (one per request with the access log) needs one.
const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatIn(timeZone: string): Intl.DateTimeFormat {
  let format = wallClockFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallClockFormats.set(timeZone, format);
  }
  return format;
}

// `YYYY-MM-DDTHH:mm:ss.SSS±HH:MM`: the wall time in the time zone and its offset from UTC at that
// moment, so the two 02:30 of the autumn clock change stay apart (+02:00, then +01:00).
export function isoTimestampIn(timeZone: string, at: Date): string {
  const parts = wallClockFormatIn(timeZone).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((entry) => entry.type === type)?.value;
    if (value === undefined) {
      throw new Error(`No ${type} in the formatted date`);
    }
    return Number(value);
  };
  const [year, month, day] = [part('year'), part('month'), part('day')];
  const [hour, minute, second] = [part('hour'), part('minute'), part('second')];
  // The wall time read as if it were UTC, minus the moment (without its milliseconds, which the
  // wall time does not carry): the offset of the zone in minutes.
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round(
    (wallAsUtc - (at.getTime() - at.getUTCMilliseconds())) / 60_000,
  );
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${twoDigits(Math.floor(absolute / 60))}:${twoDigits(absolute % 60)}`;
  const millis = String(at.getUTCMilliseconds()).padStart(3, '0');
  return (
    `${String(year).padStart(4, '0')}-${twoDigits(month)}-${twoDigits(day)}` +
    `T${twoDigits(hour)}:${twoDigits(minute)}:${twoDigits(second)}.${millis}${offset}`
  );
}

// Colours only in a terminal: both streams, because errors go to stderr, so `2> file` with a
// terminal on stdout must not write escape codes to the file. NO_COLOR (any non-empty value)
// turns them off everywhere, e.g. in the tests.
export function colorsEnabled(
  isTty = process.stdout.isTTY === true && process.stderr.isTTY === true,
  noColor: string | undefined = process.env.NO_COLOR,
): boolean {
  return isTty && !noColor;
}

// The whole text on a background colour when colours are on, else the text unchanged.
export function highlight(
  text: string,
  style: HighlightStyle,
  enabled = colorsEnabled(),
): string {
  return enabled ? `${ESC}[${HIGHLIGHT_CODES[style]}m${text}${RESET}` : text;
}

const STACK_FRAME = /^\s+at /;
const QUERY_FAILED_HEADER = 'QueryFailedError:';

// A stack for the log without the text of a database error: the header of a QueryFailedError
// (its message, which can quote the parameters of the query, sometimes over several lines) becomes
// `QueryFailedError: <message omitted>`; the frames stay. Any other stack is returned unchanged.
export function safeStack(stack: string): string {
  if (!stack.startsWith(QUERY_FAILED_HEADER)) {
    return stack;
  }
  const lines = stack.split('\n');
  const firstFrame = lines.findIndex((line) => STACK_FRAME.test(line));
  const frames = firstFrame === -1 ? [] : lines.slice(firstFrame);
  return [`${QUERY_FAILED_HEADER} <message omitted>`, ...frames].join('\n');
}

// A line in the same format as AppLogger's (without colours) for code that writes before the
// logger exists or outside it: `[<app>] <pid>  - <ISO time> <LEVEL> [<context>] <message>`.
export function plainLine(
  app: string,
  level: string,
  context: string,
  message: string,
  at = new Date(),
  pid = process.pid,
  timeZone = APP_TIME_ZONE,
): string {
  return `[${app}] ${pid}  - ${isoTimestampIn(timeZone, at)} ${level.toUpperCase().padStart(7, ' ')} [${context}] ${message}`;
}
