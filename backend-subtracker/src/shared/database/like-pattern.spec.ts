import { containsPattern } from './like-pattern.js';

describe('containsPattern', () => {
  it('wraps a plain fragment in wildcards', () => {
    expect(containsPattern('kowal')).toBe('%kowal%');
  });

  it.each([
    ['%', String.raw`%a\%b%`],
    ['_', String.raw`%a\_b%`],
    ['\\', String.raw`%a\\b%`],
  ])('escapes %s so it matches only itself', (char, pattern) => {
    expect(containsPattern(`a${char}b`)).toBe(pattern);
  });

  it('escapes every occurrence', () => {
    expect(containsPattern('%_%')).toBe(String.raw`%\%\_\%%`);
  });
});
