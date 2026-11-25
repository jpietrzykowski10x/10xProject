import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ErrorReporter } from './error-reporter';

// The oracle is the rule "one console line with the context and the description, the raw error
// next to it for the visitor's own console".

it('writes one console line with the context, the description and the raw error', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const error = new HttpErrorResponse({ status: 500, url: 'http://localhost:3000/budget?x=1' });

    TestBed.inject(ErrorReporter).report('Budget', error);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[Budget] HTTP 500 /budget', error);
  } finally {
    consoleError.mockRestore();
  }
});

it('writes nothing for a 401, which the session-expired interceptor already handles', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    TestBed.inject(ErrorReporter).report(
      'Subscriptions',
      new HttpErrorResponse({ status: 401, url: 'http://localhost:3000/subscriptions' }),
    );

    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
  }
});
