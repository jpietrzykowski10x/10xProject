// A stale application file after a deploy: the deploy replaces the whole directory, so a tab opened
// before it asks for a chunk-*.js that is gone (404) and the browser rejects the lazy import. The
// only sure cure is a full page load, which fetches the new index and its new chunks. These are
// the decisions behind that reload, kept free of window so they can be tested on their own.

const STORAGE_KEY = 'subtracker.chunk-reload';
const RELOAD_WINDOW_MS = 60_000;

// The messages browsers give the TypeError of a failed import(): Chrome and Edge "Failed to fetch
// dynamically imported module", Firefox "error loading dynamically imported module", Safari
// "Importing a module script failed".
const CHUNK_LOAD_MESSAGES = ['dynamically imported module', 'Importing a module script failed'];

export function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    CHUNK_LOAD_MESSAGES.some((message) => error.message.includes(message))
  );
}

// The last reloads, address → time, under one key. A map rather than one entry, so each address
// has its own window: with a single entry a redirect A → B → A overwrote it on every reload.
// Stored as a JSON object, read into a Map (an address such as `__proto__` stays a plain key).
type ReloadLog = Map<string, number>;

const MAX_ENTRIES = 10;

function parseLog(raw: string | null): ReloadLog {
  const log: ReloadLog = new Map();
  if (raw === null) {
    return log;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [url, at] of Object.entries(value)) {
        if (typeof at === 'number') {
          log.set(url, at);
        }
      }
    }
  } catch {
    // A damaged entry counts as no entry; it is overwritten below.
  }
  return log;
}

// Whether to reload the page for `url`, remembering the reload before it happens: each address is
// reloaded at most once per 60 s, so a file that is still missing after the reload cannot loop,
// nor can two addresses redirecting to each other. Entries older than 60 s are dropped and at most
// the 10 newest kept. Without a working storage there is no reload at all, since nothing would
// stop a loop.
export function shouldReload(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  url: string,
  now: number,
): boolean {
  if (storage === null) {
    return false;
  }
  // Only the path is remembered: a query can carry a sign-in token or a searched e-mail address,
  // and the entry stays in the tab's storage until the next write.
  const path = url.split(/[?#]/, 1)[0];
  try {
    const log = parseLog(storage.getItem(STORAGE_KEY));
    const last = log.get(path);
    if (last !== undefined && now - last < RELOAD_WINDOW_MS) {
      return false;
    }
    const recent = [...log]
      .filter(([other, at]) => other !== path && now - at < RELOAD_WINDOW_MS)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_ENTRIES - 1);
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries([[path, now], ...recent])));
    return true;
  } catch {
    return false;
  }
}
