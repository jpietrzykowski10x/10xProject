import { QueryFailedError } from 'typeorm';
import { isConnectionFailure } from './connection-failure.js';

function queryError(code: string): QueryFailedError {
  return new QueryFailedError(
    'UPDATE',
    [],
    Object.assign(new Error('failed'), { code }),
  );
}

describe('isConnectionFailure', () => {
  it('is true for a lost connection, a server shutdown and socket errors', () => {
    expect(isConnectionFailure(queryError('08006'))).toBe(true);
    expect(isConnectionFailure(queryError('57P01'))).toBe(true);
    expect(
      isConnectionFailure(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe(true);
  });

  it('is false for an error in the data of one row', () => {
    expect(isConnectionFailure(queryError('22008'))).toBe(false);
    expect(isConnectionFailure(queryError('23505'))).toBe(false);
    expect(isConnectionFailure(new TypeError('x is undefined'))).toBe(false);
    expect(isConnectionFailure('db down')).toBe(false);
  });
});
