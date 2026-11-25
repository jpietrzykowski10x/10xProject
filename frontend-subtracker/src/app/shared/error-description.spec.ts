import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError, timeout, NEVER, firstValueFrom } from 'rxjs';
import { describeError } from './error-description';

// The oracle is the rule "one line with the status and the path, or the error's name and message,
// and nothing that may carry personal data": no query, no fragment, no response body.

describe('describeError', () => {
  it('gives the status and the path of an HTTP error, without the query and the fragment', () => {
    const error = new HttpErrorResponse({
      status: 500,
      url: 'http://localhost:3000/admin/users?q=anna%40example.com#top',
      error: { message: 'anna@example.com' },
    });

    expect(describeError(error)).toBe('HTTP 500 /admin/users');
  });

  it('gives status 0 for a network error with a ProgressEvent', () => {
    const error = new HttpErrorResponse({
      status: 0,
      url: 'http://localhost:3000/auth/session',
      error: new ProgressEvent('error'),
    });

    expect(describeError(error)).toBe('HTTP 0 /auth/session');
  });

  it('keeps only the path of a relative URL', () => {
    const error = new HttpErrorResponse({ status: 503, url: '/budget?x=1' });

    expect(describeError(error)).toBe('HTTP 503 /budget');
  });

  it('writes - when the HTTP error has no URL', () => {
    expect(describeError(new HttpErrorResponse({ status: 502 }))).toBe('HTTP 502 -');
  });

  it('gives the name and the message of an Error on one line', () => {
    expect(describeError(new TypeError('first\nsecond\r\tthird'))).toBe(
      'TypeError: first?second??third',
    );
  });

  it('cuts a long message to 200 characters with an ellipsis', () => {
    const description = describeError(new Error('x'.repeat(500)));

    expect(description).toHaveLength(200);
    expect(description.startsWith('Error: xxx')).toBe(true);
    expect(description.endsWith('…')).toBe(true);
  });

  it('names the TimeoutError of rxjs', async () => {
    vi.useFakeTimers();
    try {
      const result = firstValueFrom(NEVER.pipe(timeout(10))).catch((error: unknown) => error);
      vi.advanceTimersByTime(10);
      const error = await result;

      expect(error).toBeInstanceOf(TimeoutError);
      expect(describeError(error)).toBe('TimeoutError: Timeout has occurred');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the type of a value that is not an error', () => {
    expect(describeError('boom')).toBe('Unknown error (string)');
    expect(describeError(undefined)).toBe('Unknown error (undefined)');
    expect(describeError(null)).toBe('Unknown error (object)');
  });
});
