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

interface ReloadEntry {
  url: string;
  at: number;
}

function parseEntry(raw: string | null): ReloadEntry | null {
  if (raw === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'url' in value &&
      'at' in value &&
      typeof value.url === 'string' &&
      typeof value.at === 'number'
    ) {
      return { url: value.url, at: value.at };
    }
  } catch {
    // A damaged entry counts as no entry; it is overwritten below.
  }
  return null;
}

// Whether to reload the page for `url`, remembering the reload before it happens: the same address
// is reloaded at most once per 60 s, so a file that is still missing after the reload cannot loop.
// Without a working storage there is no reload at all, since nothing would stop a loop.
export function shouldReload(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  url: string,
  now: number,
): boolean {
  if (storage === null) {
    return false;
  }
  try {
    const last = parseEntry(storage.getItem(STORAGE_KEY));
    if (last !== null && last.url === url && now - last.at < RELOAD_WINDOW_MS) {
      return false;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({ url, at: now }));
    return true;
  } catch {
    return false;
  }
}
