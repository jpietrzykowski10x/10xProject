import { QueryFailedError } from 'typeorm';
import { AppLogger } from './app-logger.js';

const NOW = new Date('2026-11-25T01:00:03.412Z');

function setTty(stdout: boolean | undefined, stderr: boolean | undefined) {
  Object.defineProperty(process.stdout, 'isTTY', {
    value: stdout,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(process.stderr, 'isTTY', {
    value: stderr,
    configurable: true,
    writable: true,
  });
}

describe('AppLogger', () => {
  const originalTty = [process.stdout.isTTY, process.stderr.isTTY] as const;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    setTty(...originalTty);
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes the app prefix, the ISO time in Warsaw with its offset, the level and the context', () => {
    new AppLogger('subtracker-api').log('Started', 'Bootstrap');

    expect(out).toEqual([
      `[subtracker-api] ${process.pid}  - 2026-11-25T02:00:03.412+01:00     LOG [Bootstrap] Started\n`,
    ]);
  });

  it('writes no escape code without a terminal, even without NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '');
    setTty(false, false);
    const logger = new AppLogger('subtracker-api');

    logger.log('ok', 'Access');
    logger.error('broken', new Error('x').stack, 'ExceptionsHandler');

    expect(out.length + err.length).toBeGreaterThan(0);
    expect([...out, ...err].join('')).not.toContain('\x1b');
  });

  it('writes no escape code when only stdout is a terminal (stderr redirected to a file)', () => {
    vi.stubEnv('NO_COLOR', '');
    setTty(true, false);

    new AppLogger('subtracker-api').error('broken', 'ExceptionsHandler');

    expect(err.join('')).not.toContain('\x1b');
  });

  it('colours the line in a terminal without NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '');
    setTty(true, true);

    new AppLogger('subtracker-api').log('ok', 'Access');

    expect(out.join('')).toContain('\x1b');
  });

  it('writes the stack of a failed query without its message', () => {
    const failure = new QueryFailedError(
      'INSERT INTO "user"',
      ['jan@example.com'],
      Object.assign(new Error('duplicate key jan@example.com'), {
        code: '23505',
      }),
    );

    new AppLogger('subtracker-api').error(
      'Saving failed (code: 23505)',
      failure.stack,
      'MailService',
    );

    const written = err.join('');
    expect(written).toContain('Saving failed (code: 23505)');
    expect(written).toContain('QueryFailedError: <message omitted>');
    expect(written).toContain('    at ');
    expect(written).not.toContain('jan@example.com');
  });

  it('writes a failed query given as the message only by its code and frames', () => {
    const failure = new QueryFailedError(
      'SELECT * FROM "user" WHERE email = $1',
      ['jan@example.com'],
      Object.assign(new Error('no user jan@example.com'), {
        code: '57014',
        detail: 'Key (email)=(jan@example.com)',
      }),
    );

    // As Nest's ExceptionHandler and the schedule explorer call it: the error as the message.
    new AppLogger('subtracker-api').error(failure);

    const written = err.join('');
    expect(written).toContain('QueryFailedError (code: 57014)');
    expect(written).toContain('    at ');
    expect(written).not.toContain('jan@example.com');
    expect(written).not.toContain('SELECT');
  });
});
