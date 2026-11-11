import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './unique-violation.js';

const failure = (driverError: object) =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('db'), driverError),
  );

describe('isUniqueViolation', () => {
  it('matches a 23505 on the named constraint', () => {
    expect(
      isUniqueViolation(failure({ code: '23505', constraint: 'UQ_x' }), 'UQ_x'),
    ).toBe(true);
  });

  it('ignores another constraint, another code and other errors', () => {
    expect(
      isUniqueViolation(failure({ code: '23505', constraint: 'UQ_y' }), 'UQ_x'),
    ).toBe(false);
    expect(
      isUniqueViolation(failure({ code: '23503', constraint: 'UQ_x' }), 'UQ_x'),
    ).toBe(false);
    expect(isUniqueViolation(new Error('other'), 'UQ_x')).toBe(false);
  });
});
