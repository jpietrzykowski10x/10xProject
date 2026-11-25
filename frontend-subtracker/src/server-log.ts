// The log line format of the SSR server (server.ts), the same as the API's
// (backend-subtracker/src/shared/logging/log-format.ts), which this app shares no code with:
// `[subtracker-frontend] <pid>  - <ISO time in Warsaw> <LEVEL> [<context>] <message>`.
// Pure on purpose: no `node:*` imports and no file reads, because the spec is bundled and run by
// @angular/build:unit-test like app code. server.ts reads the files and the request.

export const SERVER_APP_NAME = 'subtracker-frontend';
export const SERVER_TIME_ZONE = 'Europe/Warsaw';

// What a release without .deploy-info reports: local runs, e2e and releases before the file.
export const DEV_VERSION = 'dev';

export type ServerLogLevel = 'LOG' | 'ERROR';

const ESC = '\x1b';
const RESET = `${ESC}[0m`;

// The level colours of the API's (Nest) logger.
const LEVEL_COLORS: Readonly<Record<ServerLogLevel, string>> = {
  LOG: '32', // green
  ERROR: '31', // red
};

const MAX_PATH_LENGTH = 200;
const ELLIPSIS = '…';
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/g;

const SHA_LINE = /^SHA=(.*)$/m;
const SHA_VALUE = /^[0-9a-f]{7,40}$/;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

// One formatter per time zone: building an Intl.DateTimeFormat costs far more than using it, and
// every access-log line needs one.
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
  const offsetMinutes = Math.round((wallAsUtc - (at.getTime() - at.getUTCMilliseconds())) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${twoDigits(Math.floor(absolute / 60))}:${twoDigits(absolute % 60)}`;
  const millis = String(at.getUTCMilliseconds()).padStart(3, '0');
  return (
    `${String(year).padStart(4, '0')}-${twoDigits(month)}-${twoDigits(day)}` +
    `T${twoDigits(hour)}:${twoDigits(minute)}:${twoDigits(second)}.${millis}${offset}`
  );
}

// Colours only in a terminal: both streams, so `2> file` with a terminal on stdout writes no
// escape codes to the file. NO_COLOR (any non-empty value) turns them off everywhere.
export function colorsEnabled(
  isTty = process.stdout?.isTTY === true && process.stderr?.isTTY === true,
  noColor: string | undefined = process.env['NO_COLOR'],
): boolean {
  return isTty && !noColor;
}

// One line of the SSR server's log; the level is coloured only when `colors` is on.
export function serverLine(
  level: ServerLogLevel,
  context: string,
  message: string,
  at = new Date(),
  pid = process.pid,
  colors = colorsEnabled(),
): string {
  const paddedLevel = level.padStart(7, ' ');
  const shownLevel = colors ? `${ESC}[${LEVEL_COLORS[level]}m${paddedLevel}${RESET}` : paddedLevel;
  return `[${SERVER_APP_NAME}] ${pid}  - ${isoTimestampIn(SERVER_TIME_ZONE, at)} ${shownLevel} [${context}] ${message}`;
}

// A request path fit for the log: control characters (a forged path could fake a new log line)
// become `?`, and a path longer than 200 characters is cut to 200 with `…` at the end.
export function safePath(path: string): string {
  const clean = path.replace(CONTROL_CHARACTERS, '?');
  return clean.length > MAX_PATH_LENGTH
    ? `${clean.slice(0, MAX_PATH_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
    : clean;
}

// The parts of an Express request the access log may read. `originalUrl` is listed only to say
// that it is never used: it carries the query (e.g. `?q=<searched address>`).
export interface AccessLogRequest {
  readonly method: string;
  readonly path: string;
  readonly originalUrl?: string;
}

// The message of an access log line: `<METHOD> <path without query> <status|aborted> <ms> ms`.
export function accessMessage(
  req: AccessLogRequest,
  status: number | 'aborted',
  ms: number,
): string {
  return `${req.method} ${safePath(req.path)} ${status} ${ms} ms`;
}

// The lines of the log for a render that failed (handle() rejected, server.ts error middleware):
// first `<METHOD> <path without query> <name>: <message on one line>` (the message cut like a
// path), then the frames of the stack, each a line of its own, without the stack's own heading,
// which repeats the message. Null for an AbortError: the client closed the connection, and the
// access log already shows `aborted`.
export function renderErrorLines(req: AccessLogRequest, error: unknown): string[] | null {
  if (isAbortError(error)) {
    return null;
  }
  if (!(error instanceof Error)) {
    return [`${req.method} ${safePath(req.path)} Unknown error (${typeof error})`];
  }
  const heading = error.message === '' ? error.name : `${error.name}: ${error.message}`;
  const first = `${req.method} ${safePath(req.path)} ${safePath(heading)}`;
  const stack = error.stack ?? '';
  // V8 starts the stack with the heading (the message possibly over several lines); everything
  // after it is a frame. A stack that does not start with it is kept whole.
  const frames = stack.startsWith(heading) ? stack.slice(heading.length) : stack;
  return [
    first,
    ...frames
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.replace(CONTROL_CHARACTERS, '?')),
  ];
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

// The commit SHA from the text of `.deploy-info` (written by deploy.sh; null when there is no
// file). Only the SHA= line is read: the file also holds BACKUP=<dump path>, which must never be
// logged. Anything else (no file, no line, a malformed value) gives `dev`.
export function deployedVersionFrom(text: string | null): string {
  if (text === null) {
    return DEV_VERSION;
  }
  const value = SHA_LINE.exec(text)?.[1]?.trim();
  return value !== undefined && SHA_VALUE.test(value) ? value : DEV_VERSION;
}
