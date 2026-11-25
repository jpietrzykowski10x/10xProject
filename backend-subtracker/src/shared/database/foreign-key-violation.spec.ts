import { QueryFailedError } from 'typeorm';
import { isForeignKeyViolation } from './foreign-key-violation.js';

const failure = (driverError: object) =>
  new QueryFailedError(
    'DELETE',
    [],
    Object.assign(new Error('db'), driverError),
  );

describe('isForeignKeyViolation', () => {
  it('matches a 23503 on the named constraint', () => {
    expect(
      isForeignKeyViolation(
        failure({ code: '23503', constraint: 'FK_x' }),
        'FK_x',
      ),
    ).toBe(true);
  });

  it('ignores another constraint and another code', () => {
    expect(
      isForeignKeyViolation(
        failure({ code: '23503', constraint: 'FK_y' }),
        'FK_x',
      ),
    ).toBe(false);
    expect(
      isForeignKeyViolation(
        failure({ code: '23505', constraint: 'FK_x' }),
        'FK_x',
      ),
    ).toBe(false);
  });

  it('ignores an error that is not a query failure and a value that is not an error', () => {
    expect(isForeignKeyViolation(new Error('other'), 'FK_x')).toBe(false);
    expect(
      isForeignKeyViolation({ code: '23503', constraint: 'FK_x' }, 'FK_x'),
    ).toBe(false);
    expect(isForeignKeyViolation(undefined, 'FK_x')).toBe(false);
  });
});
