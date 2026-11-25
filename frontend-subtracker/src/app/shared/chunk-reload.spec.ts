import { isChunkLoadError, shouldReload } from './chunk-reload';

// The oracle is the plan's loop protection: each address is reloaded at most once per 60 s,
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
  return { [KEY]: JSON.stringify({ [url]: at }) };
}

function stored(storage: Pick<Storage, 'getItem'>): unknown {
  return JSON.parse(storage.getItem(KEY) ?? 'null');
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
      initial: { [KEY]: JSON.stringify({ '/register': 'x' }) },
      url: '/register',
      expected: true,
    },
    {
      name: 'an array in the key',
      initial: { [KEY]: JSON.stringify(['/register', NOW]) },
      url: '/register',
      expected: true,
    },
  ])('$name gives $expected', ({ initial, url, expected }) => {
    const storage = memoryStorage(initial);

    expect(shouldReload(storage, url, NOW)).toBe(expected);
    if (expected) {
      // Remembered before the reload, so the next failure within 60 s does not reload again.
      expect(stored(storage)).toEqual(expect.objectContaining({ [url]: NOW }));
    }
  });

  it('gives each address its own window, so A → B → A within 60 s does not loop', () => {
    const storage = memoryStorage();

    expect(shouldReload(storage, '/a', NOW)).toBe(true);
    expect(shouldReload(storage, '/b', NOW + 1_000)).toBe(true);
    expect(shouldReload(storage, '/a', NOW + 2_000)).toBe(false);
    expect(stored(storage)).toEqual({ '/a': NOW, '/b': NOW + 1_000 });
  });

  it('drops entries older than 60 s and keeps at most the 10 newest', () => {
    const initial: Record<string, number> = { '/old': NOW - 61_000 };
    for (let i = 0; i < 12; i++) {
      initial[`/p${i}`] = NOW - 30_000 + i;
    }
    const storage = memoryStorage({ [KEY]: JSON.stringify(initial) });

    expect(shouldReload(storage, '/new', NOW)).toBe(true);

    const log = stored(storage) as Record<string, number>;
    expect(Object.keys(log).sort()).toEqual(
      ['/new', ...[3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `/p${i}`)].sort(),
    );
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
