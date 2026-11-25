import { HttpErrorResponse } from '@angular/common/http';

// A one-line description of an error, fit for the browser console and the SSR log alike: no
// response body, no query string and no fragment (they can carry an e-mail address, e.g. the
// `q` of the admin search), no control characters (a forged text could fake a new log line) and
// at most 200 characters. Kept apart from src/server-log.ts on purpose: that file belongs to the
// SSR server and must stay out of the browser bundle.

const MAX_LENGTH = 200;
const ELLIPSIS = '…';
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/g;
// Any base will do: it only lets a relative URL be parsed, and only the path is kept.
const URL_BASE = 'http://localhost';

function oneLine(text: string): string {
  const clean = text.replace(CONTROL_CHARACTERS, '?');
  return clean.length > MAX_LENGTH
    ? `${clean.slice(0, MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
    : clean;
}

// The path of a request URL without its query and fragment; `-` when the response has no URL.
function pathOf(url: string | null): string {
  if (url === null || url === '') {
    return '-';
  }
  try {
    return new URL(url, URL_BASE).pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] ?? '-';
  }
}

export function describeError(error: unknown): string {
  // Checked first: an HttpErrorResponse is not an Error, and its `message` carries the full URL.
  if (error instanceof HttpErrorResponse) {
    return oneLine(`HTTP ${error.status} ${pathOf(error.url)}`);
  }
  if (error instanceof Error) {
    return oneLine(`${error.name}: ${error.message}`);
  }
  return `Unknown error (${typeof error})`;
}
