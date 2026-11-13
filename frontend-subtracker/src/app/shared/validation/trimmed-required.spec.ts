import { FormControl } from '@angular/forms';
import { trimmedRequired } from './trimmed-required';

// The oracle is the API contract (backend create DTOs): names are trimmed before they are checked,
// so a name made only of spaces is empty.
describe('trimmedRequired', () => {
  it.each(['', ' ', '   ', '\t', ' \n '])('flags %j as required', (value) => {
    expect(trimmedRequired(new FormControl(value, { nonNullable: true }))).toEqual({
      required: true,
    });
  });

  it.each(['a', ' a ', 'Netflix', '  Disney+  '])('accepts %j', (value) => {
    expect(trimmedRequired(new FormControl(value, { nonNullable: true }))).toBeNull();
  });
});
