import { parseCorsOrigins } from './cors.js';

describe('parseCorsOrigins', () => {
  it('accepts a single origin', () => {
    expect(parseCorsOrigins('http://localhost:4200')).toEqual([
      'http://localhost:4200',
    ]);
  });

  it('splits a list and trims spaces', () => {
    expect(
      parseCorsOrigins(' http://localhost:4200 , https://example.com '),
    ).toEqual(['http://localhost:4200', 'https://example.com']);
  });

  it('strips a trailing slash', () => {
    expect(parseCorsOrigins('https://example.com/')).toEqual([
      'https://example.com',
    ]);
  });

  it('skips empty entries', () => {
    expect(parseCorsOrigins('https://example.com,,')).toEqual([
      'https://example.com',
    ]);
  });

  it('rejects an empty list', () => {
    expect(() => parseCorsOrigins(' , ')).toThrow(/at least one origin/);
  });

  it('rejects a wildcard', () => {
    expect(() => parseCorsOrigins('https://example.com,*')).toThrow(/"\*"/);
  });
});
