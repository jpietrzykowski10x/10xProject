import {
  DEFAULT_DUPLICATE_THRESHOLD,
  DUPLICATE_THRESHOLD_MAX,
  DUPLICATE_THRESHOLD_MIN,
  DuplicateWarning,
  duplicateWarning,
} from './duplicate-warning.js';

// The oracle is the rule from the S-07 plan: more than the threshold is exceeded, exactly the
// threshold is reached when at least one subscription is counted, anything else is no warning.
describe('duplicateWarning', () => {
  it.each([
    // threshold 0, empty category: nothing to warn about
    [0, 0, DuplicateWarning.NONE],
    // threshold 0: the first subscription is already over it
    [1, 0, DuplicateWarning.EXCEEDED],
    // threshold 1: the lowest count that can reach a threshold
    [1, 1, DuplicateWarning.REACHED],
    // below a threshold of 2
    [1, 2, DuplicateWarning.NONE],
    // exactly a threshold of 2
    [2, 2, DuplicateWarning.REACHED],
    // one over a threshold of 2
    [3, 2, DuplicateWarning.EXCEEDED],
    // exactly the highest threshold
    [99, 99, DuplicateWarning.REACHED],
    // one over the highest threshold
    [100, 99, DuplicateWarning.EXCEEDED],
  ])(
    'gives %i subscriptions with a threshold of %i the warning %j',
    (count, threshold, expected) => {
      expect(duplicateWarning(count, threshold)).toBe(expected);
    },
  );

  it('has a default of 3 within 0–99', () => {
    expect(DEFAULT_DUPLICATE_THRESHOLD).toBe(3);
    expect(DUPLICATE_THRESHOLD_MIN).toBe(0);
    expect(DUPLICATE_THRESHOLD_MAX).toBe(99);
  });
});
