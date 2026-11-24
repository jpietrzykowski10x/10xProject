import { QueryFailedError } from 'typeorm';
import { failureCodeOf } from './failure-code.js';

describe('failureCodeOf', () => {
  it('returns the database code of a failed query', () => {
    const error = new QueryFailedError(
      'SELECT secret',
      [],
      Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
      }),
    );

    expect(failureCodeOf(error)).toBe('57014');
  });

  it('returns the code of an error that has one', () => {
    expect(
      failureCodeOf(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe('ECONNREFUSED');
  });

  it('returns the class of an error without a code', () => {
    expect(failureCodeOf(new Error('jan@example.com'))).toBe('Error');
    expect(failureCodeOf(new TypeError('x is undefined'))).toBe('TypeError');
  });

  it('returns unknown for a value that is not an error', () => {
    expect(failureCodeOf('db down')).toBe('unknown');
    expect(failureCodeOf(undefined)).toBe('unknown');
  });
});
