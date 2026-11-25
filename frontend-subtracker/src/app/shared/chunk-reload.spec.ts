import { isChunkLoadError, shouldReload } from './chunk-reload';

// The oracle is the plan's loop protection: the same address is reloaded at most once per 60 s,
// the reload is remembered before it happens, and without a working storage there is no reload.

const KEY = 'subtracker.chunk-reload';
const NOW = 1_800_000_000_000;

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function entry(url: string, at: number): Record<string, string> {
  return { [KEY]: JSON.stringify({ url, at }) };
}

describe('shouldReload', () => {
  it.each([
    { name: 'the first time', initial: {}, url: '/register', expected: true },
    {
      name: 'the same address after 59 s',
      initial: entry('/register', NOW - 59_000),
      url: '/register',
      expected: false,
    },
    {
      name: 'the same address after 61 s',
      initial: entry('/register', NOW - 61_000),
      url: '/register',
      expected: true,
    },
    {
      name: 'another address within 60 s',
      initial: entry('/sign-in', NOW - 1_000),
      url: '/register',
      expected: true,
    },
    {
      name: 'garbage in the key',
      initial: { [KEY]: '{not json' },
      url: '/register',
      expected: true,
    },
    {
      name: 'an entry of the wrong shape',
      initial: { [KEY]: JSON.stringify({ url: 1, at: 'x' }) },
      url: '/register',
      expected: true,
    },
  ])('$name gives $expected', ({ initial, url, expected }) => {
    const storage = memoryStorage(initial);

    expect(shouldReload(storage, url, NOW)).toBe(expected);
    if (expected) {
      // Remembered before the reload, so the next failure within 60 s does not reload again.
      expect(JSON.parse(storage.getItem(KEY) ?? 'null')).toEqual({ url, at: NOW });
    }
  });

  it('does not reload without a storage', () => {
    expect(shouldReload(null, '/register', NOW)).toBe(false);
  });

  it.each([
    {
      name: 'setItem throws',
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      },
    },
    {
      name: 'setItem throws over a damaged entry',
      storage: {
        getItem: () => 'garbage',
        setItem: () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      },
    },
    {
      name: 'getItem throws',
      storage: {
        getItem: () => {
          throw new DOMException('denied', 'SecurityError');
        },
        setItem: () => {},
      },
    },
  ])('does not reload when $name', ({ storage }) => {
    expect(shouldReload(storage, '/register', NOW)).toBe(false);
  });
});

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: http://localhost:4000/chunk-ABC.js',
    'error loading dynamically imported module: http://localhost:4000/chunk-ABC.js',
    'Importing a module script failed.',
  ])('recognizes the TypeError "%s"', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it.each([
    { name: 'a plain TypeError', error: new TypeError('Cannot read properties of undefined') },
    {
      name: 'an Error with the same message',
      error: new Error('Importing a module script failed.'),
    },
    { name: 'a string', error: 'Failed to fetch dynamically imported module' },
    { name: 'undefined', error: undefined },
  ])('does not take $name for a chunk error', ({ error }) => {
    expect(isChunkLoadError(error)).toBe(false);
  });
});
