import { HttpErrorResponse } from '@angular/common/http';
import { REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { ServerErrorReporter } from './server-error-reporter';
import { ErrorReporter } from './shared/error-reporter';

// The oracle is the S-14 line format of the SSR log: `[subtracker-frontend] <pid>  - <time> ERROR
// [<context>] <METHOD> <path without query> <description>`, without colours under NO_COLOR.

const LINE_START =
  /^\[subtracker-frontend\] \d+ {2}- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} {3}ERROR /;

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.stubEnv('NO_COLOR', '1');
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.unstubAllEnvs();
});

function reporterWith(request: Request | null): ErrorReporter {
  TestBed.configureTestingModule({
    providers: [
      { provide: ErrorReporter, useClass: ServerErrorReporter },
      { provide: REQUEST, useValue: request },
    ],
  });
  return TestBed.inject(ErrorReporter);
}

function loggedLine(): string {
  expect(consoleError).toHaveBeenCalledTimes(1);
  const [line] = consoleError.mock.calls[0] ?? [];
  if (typeof line !== 'string') {
    throw new Error('No log line was written');
  }
  return line;
}

it('writes an ERROR line with the method and the path of the request, without its query', () => {
  const reporter = reporterWith(new Request('http://localhost:4000/?q=anna%40example.com'));

  reporter.report(
    'guestGuard',
    new HttpErrorResponse({ status: 503, url: 'http://localhost:3000/auth/session' }),
  );

  const line = loggedLine();
  expect(line).toMatch(LINE_START);
  expect(line.endsWith('[guestGuard] GET / HTTP 503 /auth/session')).toBe(true);
  expect(line).not.toContain('anna');
  expect(line).not.toContain('\x1b');
});

it('writes - - without a request (prerendering at build time)', () => {
  const reporter = reporterWith(null);

  reporter.report('authGuard', new Error('boom'));

  expect(loggedLine().endsWith('[authGuard] - - Error: boom')).toBe(true);
});
