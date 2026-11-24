import {
  accessMessage,
  colorsEnabled,
  deployedVersionFrom,
  isoTimestampIn,
  safePath,
  serverLine,
} from './server-log';

// Every case passes the time zone, the moment, the pid and the colour flag explicitly, so the
// result is the same in both zones of `test:ci` and in or out of a terminal.
const WARSAW = 'Europe/Warsaw';
const AT = new Date('2026-11-25T01:00:03.412Z');
const PID = 4123;

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
    expect(isoTimestampIn('America/New_York', new Date('2026-01-15T12:00:00.000Z'))).toBe(
      '2026-01-15T07:00:00.000-05:00',
    );
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
    expect(colorsEnabled(false, '')).toBe(false);
  });

  it('is off with NO_COLOR even in a terminal', () => {
    expect(colorsEnabled(true, '1')).toBe(false);
  });
});

describe('serverLine', () => {
  it('writes the line in the format of the API logger, in Warsaw time', () => {
    expect(serverLine('LOG', 'Bootstrap', 'Started subtracker-frontend', AT, PID, false)).toBe(
      '[subtracker-frontend] 4123  - 2026-11-25T02:00:03.412+01:00     LOG [Bootstrap] Started subtracker-frontend',
    );
  });

  it('pads the ERROR level to the same width', () => {
    expect(serverLine('ERROR', 'Access', 'x', AT, PID, false)).toBe(
      '[subtracker-frontend] 4123  - 2026-11-25T02:00:03.412+01:00   ERROR [Access] x',
    );
  });

  it('carries no escape code when colours are off', () => {
    expect(serverLine('LOG', 'Access', 'x', AT, PID, false)).not.toContain('\x1b');
    expect(serverLine('ERROR', 'Access', 'x', AT, PID, false)).not.toContain('\x1b');
  });

  it('colours only the level when colours are on', () => {
    expect(serverLine('LOG', 'Access', 'x', AT, PID, true)).toBe(
      '[subtracker-frontend] 4123  - 2026-11-25T02:00:03.412+01:00 \x1b[32m    LOG\x1b[0m [Access] x',
    );
    expect(serverLine('ERROR', 'Access', 'x', AT, PID, true)).toBe(
      '[subtracker-frontend] 4123  - 2026-11-25T02:00:03.412+01:00 \x1b[31m  ERROR\x1b[0m [Access] x',
    );
  });
});

describe('safePath', () => {
  it('leaves an ordinary path unchanged', () => {
    expect(safePath('/admin/users/3f2b')).toBe('/admin/users/3f2b');
  });

  it('replaces control characters with ?', () => {
    expect(safePath('/a\nb\rc\td\x00e\x1bf\x7fg')).toBe('/a?b?c?d?e?f?g');
  });

  it('keeps a path of exactly 200 characters whole', () => {
    const path = `/${'a'.repeat(199)}`;

    expect(safePath(path)).toBe(path);
  });

  it('cuts a longer path to 200 characters ending with …', () => {
    const safe = safePath(`/${'a'.repeat(500)}`);

    expect(safe).toHaveLength(200);
    expect(safe).toBe(`/${'a'.repeat(198)}…`);
  });
});

describe('accessMessage', () => {
  it('gives the method, the path without the query, the status and the time', () => {
    const req = {
      method: 'GET',
      path: '/admin/users',
      originalUrl: '/admin/users?q=anna@example.com&token=abc',
    };

    const message = accessMessage(req, 200, 12);

    expect(message).toBe('GET /admin/users 200 12 ms');
    expect(message).not.toContain('?');
    expect(message).not.toContain('anna@example.com');
    expect(message).not.toContain('token');
  });

  it('reports a request cut off by the client as aborted', () => {
    expect(accessMessage({ method: 'GET', path: '/' }, 'aborted', 3)).toBe('GET / aborted 3 ms');
  });

  it('cuts a long path and replaces control characters', () => {
    const message = accessMessage({ method: 'GET', path: `/x\n${'b'.repeat(400)}` }, 404, 1);

    expect(message).not.toContain('\n');
    expect(message).toBe(`GET /x?${'b'.repeat(196)}… 404 1 ms`);
  });
});

describe('deployedVersionFrom', () => {
  const SHA = '0123456789abcdef0123456789abcdef01234567';

  it('gives the full SHA of the release', () => {
    expect(deployedVersionFrom(`SHA=${SHA}\nBACKUP=/home/u/backups/api-2026.sql\n`)).toBe(SHA);
  });

  it('gives a short SHA too, trimmed', () => {
    expect(deployedVersionFrom('BACKUP=/x.sql\nSHA=abc1234 \n')).toBe('abc1234');
  });

  it('gives dev without the file', () => {
    expect(deployedVersionFrom(null)).toBe('dev');
  });

  it('gives dev with BACKUP and no SHA, never the backup path', () => {
    const version = deployedVersionFrom('BACKUP=/home/u/backups/api-2026.sql\n');

    expect(version).toBe('dev');
  });

  it('gives dev for a malformed SHA', () => {
    expect(deployedVersionFrom('SHA=not-a-sha; rm -rf /\n')).toBe('dev');
    expect(deployedVersionFrom('SHA=ABC1234\n')).toBe('dev');
    expect(deployedVersionFrom('SHA=abc12\n')).toBe('dev');
    expect(deployedVersionFrom('')).toBe('dev');
  });
});
