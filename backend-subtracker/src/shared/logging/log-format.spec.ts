import { QueryFailedError } from 'typeorm';
import {
  colorsEnabled,
  highlight,
  isoTimestampIn,
  plainLine,
  safeStack,
} from './log-format.js';

const WARSAW = 'Europe/Warsaw';

describe('isoTimestampIn', () => {
  it('gives the winter time in Warsaw with +01:00', () => {
    expect(isoTimestampIn(WARSAW, new Date('2026-01-15T12:00:00.123Z'))).toBe(
      '2026-01-15T13:00:00.123+01:00',
    );
  });

  it('gives the summer time in Warsaw with +02:00', () => {
    expect(isoTimestampIn(WARSAW, new Date('2026-07-15T12:00:00.007Z'))).toBe(
      '2026-07-15T14:00:00.007+02:00',
    );
  });

  it('keeps both 02:30 of the autumn clock change apart by their offsets', () => {
    // 2026-10-25: at 03:00 CEST the clocks go back to 02:00 CET.
    const summer = isoTimestampIn(WARSAW, new Date('2026-10-25T00:30:00.000Z'));
    const winter = isoTimestampIn(WARSAW, new Date('2026-10-25T01:30:00.000Z'));

    expect(summer).toBe('2026-10-25T02:30:00.000+02:00');
    expect(winter).toBe('2026-10-25T02:30:00.000+01:00');
  });

  it('gives the day in the time zone, not in UTC, around midnight', () => {
    expect(isoTimestampIn(WARSAW, new Date('2026-11-22T23:05:00.000Z'))).toBe(
      '2026-11-23T00:05:00.000+01:00',
    );
  });

  it('gives a negative offset west of UTC and +00:00 for UTC', () => {
    expect(
      isoTimestampIn('America/New_York', new Date('2026-01-15T12:00:00.000Z')),
    ).toBe('2026-01-15T07:00:00.000-05:00');
    expect(isoTimestampIn('UTC', new Date('2026-01-15T12:00:00.000Z'))).toBe(
      '2026-01-15T12:00:00.000+00:00',
    );
  });
});

describe('colorsEnabled', () => {
  it('is on only in a terminal without NO_COLOR', () => {
    expect(colorsEnabled(true, '')).toBe(true);
  });

  it('is off without a terminal', () => {
    // An empty NO_COLOR counts as unset (no-color.org); undefined would read the real one.
    expect(colorsEnabled(false, '')).toBe(false);
  });

  it('is off with NO_COLOR even in a terminal', () => {
    expect(colorsEnabled(true, '1')).toBe(false);
  });

  it('is off in the tests, which set NO_COLOR', () => {
    expect(colorsEnabled()).toBe(false);
  });
});

describe('highlight', () => {
  it('puts the text on the background of its style when colours are on', () => {
    expect(highlight('done', 'success', true)).toBe('\x1b[30;42mdone\x1b[0m');
    expect(highlight('broken', 'failure', true)).toBe(
      '\x1b[30;41mbroken\x1b[0m',
    );
    expect(highlight('started', 'info', true)).toBe('\x1b[44mstarted\x1b[0m');
    expect(highlight('note', 'notice', true)).toBe('\x1b[46mnote\x1b[0m');
  });

  it('returns the text unchanged when colours are off', () => {
    expect(highlight('done', 'success', false)).toBe('done');
  });

  it('leaves the text unchanged by default in the tests (NO_COLOR)', () => {
    expect(highlight('done', 'success')).toBe('done');
  });
});

describe('safeStack', () => {
  it('drops the message of a QueryFailedError and keeps the frames', () => {
    const error = new QueryFailedError(
      'INSERT INTO "user"',
      ['jan@example.com'],
      Object.assign(
        new Error(
          'duplicate key jan@example.com\nDETAIL: Key (email)=(jan@example.com)',
        ),
        { code: '23505' },
      ),
    );
    const stack = error.stack ?? '';

    const safe = safeStack(stack);

    const [header, ...frames] = safe.split('\n');
    expect(header).toBe('QueryFailedError: <message omitted>');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((line) => /^\s+at /.test(line))).toBe(true);
    expect(safe).not.toContain('jan@example.com');
    expect(safe).not.toContain('duplicate key');
  });

  it('leaves the stack of any other error unchanged', () => {
    const stack = new TypeError('Cannot read properties of undefined').stack;

    expect(safeStack(stack ?? '')).toBe(stack);
  });
});

describe('plainLine', () => {
  it('writes the line in the format of the app logger', () => {
    expect(
      plainLine(
        'subtracker-api',
        'fatal',
        'Process',
        'Fatal uncaughtException: TypeError: x',
        new Date('2026-11-25T01:00:03.412Z'),
        4123,
      ),
    ).toBe(
      '[subtracker-api] 4123  - 2026-11-25T02:00:03.412+01:00   FATAL [Process] Fatal uncaughtException: TypeError: x',
    );
  });

  it('carries no escape code', () => {
    expect(plainLine('subtracker-api', 'FATAL', 'Process', 'x')).not.toContain(
      '\x1b',
    );
  });
});
