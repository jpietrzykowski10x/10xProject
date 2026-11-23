import { FixedWindowLimiter } from './fixed-window-limiter.js';

const MINUTE = 60_000;

function limiter(): FixedWindowLimiter {
  return new FixedWindowLimiter({ limit: 10, windowMs: MINUTE });
}

function takeMany(
  subject: FixedWindowLimiter,
  key: string,
  count: number,
  now: number,
) {
  return Array.from({ length: count }, () => subject.take(key, now));
}

describe('FixedWindowLimiter', () => {
  it('lets 10 calls of a key through in a window and refuses the 11th', () => {
    const subject = limiter();

    const decisions = takeMany(subject, 'a', 11, 1000);

    expect(decisions.slice(0, 10).every((d) => d.allowed)).toBe(true);
    expect(decisions[10]).toEqual({
      allowed: false,
      suppressedInPreviousWindow: 0,
    });
  });

  it('reports the refused calls once, on the first call of the next window', () => {
    const subject = limiter();
    takeMany(subject, 'a', 13, 1000);

    expect(subject.take('a', 1000 + MINUTE)).toEqual({
      allowed: true,
      suppressedInPreviousWindow: 3,
    });
    expect(subject.take('a', 1000 + MINUTE)).toEqual({
      allowed: true,
      suppressedInPreviousWindow: 0,
    });
  });

  it('keeps the window open until a full window has passed since its first call', () => {
    const subject = limiter();
    takeMany(subject, 'a', 10, 1000);

    expect(subject.take('a', 1000 + MINUTE - 1).allowed).toBe(false);
    expect(subject.take('a', 1000 + MINUTE).allowed).toBe(true);
  });

  it('reports nothing for a window without refusals', () => {
    const subject = limiter();
    takeMany(subject, 'a', 5, 1000);

    expect(subject.take('a', 1000 + MINUTE)).toEqual({
      allowed: true,
      suppressedInPreviousWindow: 0,
    });
  });

  it('forgets refusals older than the previous window', () => {
    const subject = limiter();
    takeMany(subject, 'a', 12, 1000);

    expect(subject.take('a', 1000 + 3 * MINUTE)).toEqual({
      allowed: true,
      suppressedInPreviousWindow: 2,
    });
    expect(subject.take('a', 1000 + 5 * MINUTE)).toEqual({
      allowed: true,
      suppressedInPreviousWindow: 0,
    });
  });

  it('counts every key on its own', () => {
    const subject = limiter();
    takeMany(subject, 'a', 10, 1000);

    expect(subject.take('b', 1000).allowed).toBe(true);
    expect(subject.take('a', 1000).allowed).toBe(false);
  });

  it('refuses a limit below 1 or an empty window', () => {
    expect(
      () => new FixedWindowLimiter({ limit: 0, windowMs: MINUTE }),
    ).toThrow();
    expect(() => new FixedWindowLimiter({ limit: 10, windowMs: 0 })).toThrow();
  });
});
