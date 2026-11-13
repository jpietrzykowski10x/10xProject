import { FormControl } from '@angular/forms';
import { notBeforeDate } from './not-before-date';

// The oracle is the API rule for a trial (backend create DTO): the next billing day must not be
// earlier than the end of the trial. Both are calendar days, so the time of day never matters, and
// a missing day on either side is left to the required validators.
function check(value: Date | null, limit: Date | null) {
  return notBeforeDate(() => limit)(new FormControl<Date | null>(value));
}

describe('notBeforeDate', () => {
  it.each([
    ['the same day, earlier hour', new Date(2027, 2, 1, 0, 0), new Date(2027, 2, 1, 23, 59)],
    ['the same day, later hour', new Date(2027, 2, 1, 23, 59), new Date(2027, 2, 1, 0, 0)],
    ['the next day', new Date(2027, 2, 2), new Date(2027, 2, 1)],
    ['the next year', new Date(2028, 0, 1), new Date(2027, 11, 31, 23, 59)],
  ])('accepts %s', (_, value, limit) => {
    expect(check(value, limit)).toBeNull();
  });

  it.each([
    ['the day before', new Date(2027, 1, 28), new Date(2027, 2, 1)],
    ['the day before, late evening', new Date(2027, 1, 28, 23, 59), new Date(2027, 2, 1, 0, 0)],
    ['the year before', new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1)],
  ])('flags %s', (_, value, limit) => {
    expect(check(value, limit)).toEqual({ notBeforeDate: true });
  });

  it.each([
    ['no value', null, new Date(2027, 2, 1)],
    ['no limit', new Date(2027, 1, 28), null],
    ['neither', null, null],
  ])('leaves %s alone', (_, value, limit) => {
    expect(check(value, limit)).toBeNull();
  });
});
