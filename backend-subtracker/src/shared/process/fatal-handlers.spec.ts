import { EventEmitter } from 'node:events';
import { fatalLine, installFatalHandlers } from './fatal-handlers.js';

function setup() {
  const target = new EventEmitter();
  const log = vi.fn<(line: string) => void>();
  const exit = vi.fn<(code: number) => void>();
  installFatalHandlers(log, exit, target);
  return { target, log, exit };
}

describe('installFatalHandlers', () => {
  it('logs an uncaught exception in one line without the stack and exits with 1', () => {
    const { target, log, exit } = setup();
    const error = new TypeError('Cannot read properties of undefined');

    target.emit('uncaughtException', error);

    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Fatal uncaughtException: TypeError: Cannot read properties of undefined',
    );
    const [line] = log.mock.calls[0];
    expect(line).not.toContain('\n');
    expect(line).not.toContain(' at ');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('logs an unhandled rejection with its name and message only', () => {
    const { target, log, exit } = setup();
    const error = Object.assign(new Error('duplicate key value'), {
      parameters: ['jan@example.com'],
    });
    error.name = 'QueryFailedError';

    target.emit('unhandledRejection', error, Promise.resolve());

    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Fatal unhandledRejection: QueryFailedError: duplicate key value',
    );
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits even when logging throws', () => {
    const { target, log, exit } = setup();
    log.mockImplementation(() => {
      throw new Error('stderr closed');
    });

    expect(() => target.emit('uncaughtException', new Error('x'))).toThrow(
      'stderr closed',
    );
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('fatalLine', () => {
  it('does not print a value that is not an Error', () => {
    expect(fatalLine('unhandledRejection', 'jan@example.com')).toBe(
      'Fatal unhandledRejection: non-Error value (string)',
    );
    expect(fatalLine('uncaughtException', { token: 'secret' })).toBe(
      'Fatal uncaughtException: non-Error value (object)',
    );
  });

  it('keeps a multi-line message on one line', () => {
    expect(fatalLine('uncaughtException', new Error('first\n  second'))).toBe(
      'Fatal uncaughtException: Error: first second',
    );
  });
});
