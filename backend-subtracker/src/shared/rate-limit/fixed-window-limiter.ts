export interface FixedWindowLimiterOptions {
  // How many calls of one key the window lets through.
  limit: number;
  windowMs: number;
}

export interface LimiterDecision {
  allowed: boolean;
  // How many calls of the key the previous window refused. Above 0 only on the first allowed call
  // of a new window, so the caller reports the count once.
  suppressedInPreviousWindow: number;
}

interface KeyWindow {
  start: number;
  allowed: number;
  suppressed: number;
  // Refused in the window before this one and not reported yet.
  carried: number;
}

// At most `limit` calls per key in a fixed window, which starts with the first call of the key
// (and, after it ends, with the next call). The time comes from the caller, so tests set it.
// Keys are kept in memory and never removed: use it for a closed set of keys, never for values
// from a client.
export class FixedWindowLimiter {
  private readonly windows = new Map<string, KeyWindow>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor({ limit, windowMs }: FixedWindowLimiterOptions) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`The limit must be a positive integer, got ${limit}`);
    }
    if (!(windowMs > 0)) {
      throw new Error(`The window must be longer than 0 ms, got ${windowMs}`);
    }
    this.limit = limit;
    this.windowMs = windowMs;
  }

  take(key: string, now: number): LimiterDecision {
    const previous = this.windows.get(key);
    let window = previous;
    if (window === undefined || now - window.start >= this.windowMs) {
      window = {
        start: now,
        allowed: 0,
        suppressed: 0,
        carried: previous?.suppressed ?? 0,
      };
      this.windows.set(key, window);
    }

    if (window.allowed >= this.limit) {
      window.suppressed += 1;
      return { allowed: false, suppressedInPreviousWindow: 0 };
    }
    window.allowed += 1;
    const suppressedInPreviousWindow = window.carried;
    window.carried = 0;
    return { allowed: true, suppressedInPreviousWindow };
  }
}
