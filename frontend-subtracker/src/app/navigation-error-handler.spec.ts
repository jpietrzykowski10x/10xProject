import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationError, provideRouter, RedirectCommand, Router } from '@angular/router';
import { handleNavigationError } from './navigation-error-handler';
import { ErrorReporter } from './shared/error-reporter';

// The oracle is the plan's contract: on the server a failed navigation is reported, the response
// gets 500 and the page becomes /unavailable with the address kept. In the browser a failed lazy
// import reloads the target address once per 60 s and the next failure shows /unavailable; any
// other error is left to the router, which rethrows it.

const CAUSE = new Error('guard failed');
const NAVIGATION_ERROR = new NavigationError(1, '/e2e/navigation-error', CAUSE);
const CHUNK_ERROR = new TypeError(
  'Failed to fetch dynamically imported module: http://localhost:4000/chunk-ABC.js',
);
const CHUNK_NAVIGATION_ERROR = new NavigationError(2, '/register?from=home', CHUNK_ERROR);

interface FakeDocument {
  location: { assign: ReturnType<typeof vi.fn> };
  defaultView: { readonly sessionStorage: Storage } | null;
}

function setUp(
  platform: 'server' | 'browser',
  response: ResponseInit | null,
  document?: FakeDocument,
): ErrorReporter {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: RESPONSE_INIT, useValue: response },
      ...(document ? [{ provide: DOCUMENT, useValue: document }] : []),
    ],
  });
  return TestBed.inject(ErrorReporter);
}

function handle(error: NavigationError = NAVIGATION_ERROR): RedirectCommand | false | void {
  return TestBed.runInInjectionContext(() => handleNavigationError(error));
}

function expectUnavailable(result: RedirectCommand | false | void): void {
  expect(result).toBeInstanceOf(RedirectCommand);
  const command = result as RedirectCommand;
  expect(TestBed.inject(Router).serializeUrl(command.redirectTo)).toBe('/unavailable');
  expect(command.navigationBehaviorOptions).toEqual({ skipLocationChange: true });
}

function fakeDocument(storage: Storage | 'throws' | null): FakeDocument {
  return {
    location: { assign: vi.fn() },
    defaultView:
      storage === null
        ? null
        : {
            get sessionStorage(): Storage {
              if (storage === 'throws') {
                throw new DOMException('denied', 'SecurityError');
              }
              return storage;
            },
          },
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('on the server', () => {
  it('reports the cause, sets status 500 and shows /unavailable without changing the address', () => {
    const response: ResponseInit = { status: 200 };
    const report = vi.spyOn(setUp('server', response), 'report').mockImplementation(() => {});

    const result = handle();

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('Navigation', CAUSE);
    expect(response.status).toBe(500);
    expectUnavailable(result);
  });

  it('still redirects without a response (prerendering at build time)', () => {
    const report = vi.spyOn(setUp('server', null), 'report').mockImplementation(() => {});

    expect(handle()).toBeInstanceOf(RedirectCommand);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('in the browser', () => {
  it('leaves an error other than a failed import to the router, which rethrows it', () => {
    const document = fakeDocument(memoryStorage());
    const report = vi
      .spyOn(setUp('browser', null, document), 'report')
      .mockImplementation(() => {});

    expect(handle()).toBeUndefined();
    expect(report).not.toHaveBeenCalled();
    expect(document.location.assign).not.toHaveBeenCalled();
  });

  it('reloads the target address after a failed import, remembering it first', () => {
    const storage = memoryStorage();
    const document = fakeDocument(storage);
    document.location.assign.mockImplementation(() => {
      // The marker is already written when the reload starts, with the path only.
      const marker = storage.getItem('subtracker.chunk-reload');
      expect(marker).toContain('/register');
      expect(marker).not.toContain('from=home');
    });
    const report = vi
      .spyOn(setUp('browser', null, document), 'report')
      .mockImplementation(() => {});

    expect(handle(CHUNK_NAVIGATION_ERROR)).toBe(false);
    expect(document.location.assign).toHaveBeenCalledExactlyOnceWith('/register?from=home');
    expect(report).not.toHaveBeenCalled();
  });

  it('does not reload the same address twice within 60 s: it reports and shows /unavailable', () => {
    const document = fakeDocument(memoryStorage());
    const report = vi
      .spyOn(setUp('browser', null, document), 'report')
      .mockImplementation(() => {});

    handle(CHUNK_NAVIGATION_ERROR);
    const second = handle(CHUNK_NAVIGATION_ERROR);

    expect(document.location.assign).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith('ChunkLoad', CHUNK_ERROR);
    expectUnavailable(second);
  });

  it.each([
    { name: 'there is no window', storage: null },
    { name: 'reading sessionStorage throws', storage: 'throws' as const },
  ])('does not reload when $name: it reports and shows /unavailable', ({ storage }) => {
    const document = fakeDocument(storage);
    const report = vi
      .spyOn(setUp('browser', null, document), 'report')
      .mockImplementation(() => {});

    const result = handle(CHUNK_NAVIGATION_ERROR);

    expect(document.location.assign).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledExactlyOnceWith('ChunkLoad', CHUNK_ERROR);
    expectUnavailable(result);
  });
});
