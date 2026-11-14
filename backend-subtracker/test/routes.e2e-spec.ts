import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { Public } from './../src/shared/decorators/public.decorator.js';
import { createE2eApp, UNKNOWN_ID } from './support/e2e-app.js';

type Access = 'public' | 'session';

interface ExpectedRoute {
  method: string;
  path: string;
  access: Access;
  // The name of the test where a second account is refused this route's resource.
  twoAccountTest?: string;
}

interface AppRoute {
  method: string;
  path: string;
  access: Access;
}

// Every route the API serves. A new route fails this file until it is added here on purpose:
// - `session` unless the handler or controller carries @Public();
// - a route with a parameter in its path (e.g. `/subscriptions/:id`) also needs a test that a
//   second account gets no access to the owner's resource (two-account pattern, test plan §6.4,
//   `twoAccounts()` from test/support/e2e-app.ts, example in
//   test/subscriptions/account-isolation.e2e-spec.ts); put that test's name in `twoAccountTest`.
const EXPECTED_ROUTES: ExpectedRoute[] = [
  { method: 'GET', path: '/', access: 'public' },
  { method: 'GET', path: '/health', access: 'public' },
  { method: 'POST', path: '/auth/register', access: 'public' },
  { method: 'POST', path: '/auth/request-link', access: 'public' },
  { method: 'POST', path: '/auth/verify', access: 'public' },
  { method: 'GET', path: '/auth/session', access: 'public' },
  { method: 'GET', path: '/auth/me', access: 'session' },
  { method: 'POST', path: '/auth/logout', access: 'public' },
  { method: 'GET', path: '/categories', access: 'session' },
  { method: 'POST', path: '/categories', access: 'session' },
  { method: 'GET', path: '/subscriptions', access: 'session' },
  { method: 'POST', path: '/subscriptions', access: 'session' },
];

// The sources of every e2e file except this one, whose list names the tests itself.
function otherSpecSources(): string {
  const testDir = import.meta.dirname;
  return readdirSync(testDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.e2e-spec.ts'))
    .map((file) => join(testDir, file))
    .filter((file) => resolve(file) !== resolve(import.meta.filename))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

// A test title appears in its file as a string literal.
const hasTestTitled = (sources: string, title: string) =>
  ["'", '"', '`'].some((quote) => sources.includes(`${quote}${title}${quote}`));

const routeKey = ({ method, path }: { method: string; path: string }) =>
  `${method} ${path}`;

const byKey = (a: AppRoute, b: AppRoute) =>
  routeKey(a).localeCompare(routeKey(b));

// Nest joins the controller and the handler path; both may be a list.
type PathMetadata = string | string[] | undefined;

const pathsOf = (value: PathMetadata): string[] =>
  Array.isArray(value) ? value : [value ?? '/'];

function joinPath(controllerPath: string, handlerPath: string): string {
  const parts = [controllerPath, handlerPath]
    .flatMap((part) => part.split('/'))
    .filter((part) => part !== '');
  return `/${parts.join('/')}`;
}

describe('Routes (e2e)', () => {
  const e2e = createE2eApp({
    addressPrefix: 'e2e-routes-',
    imports: [DiscoveryModule],
  });
  const { http } = e2e;

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  function appRoutes(): AppRoute[] {
    const discovery = e2e.app.get(DiscoveryService);
    const scanner = e2e.app.get(MetadataScanner);
    const reflector = e2e.app.get(Reflector);
    const routes: AppRoute[] = [];

    for (const {
      name: controllerName,
      metatype,
    } of discovery.getControllers()) {
      // A controller is a class; anything else would hide its routes from this check.
      if (typeof metatype !== 'function') {
        throw new Error(
          `Controller ${String(controllerName)} has no class to read`,
        );
      }
      const prototype = metatype.prototype as
        Record<string, unknown> | undefined;
      if (prototype === undefined) {
        throw new Error(
          `Controller ${String(controllerName)} has no prototype to read`,
        );
      }
      const controllerPaths = pathsOf(
        reflector.get<PathMetadata>(PATH_METADATA, metatype),
      );
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') {
          continue;
        }
        const handlerPath = reflector.get<PathMetadata>(PATH_METADATA, handler);
        if (handlerPath === undefined) {
          continue;
        }
        const method =
          RequestMethod[reflector.get<RequestMethod>(METHOD_METADATA, handler)];
        // Read the same way as SessionAuthGuard does.
        const isPublic = reflector.getAllAndOverride(Public, [
          handler,
          metatype,
        ]);
        for (const controllerPath of controllerPaths) {
          for (const path of pathsOf(handlerPath)) {
            routes.push({
              method,
              path: joinPath(controllerPath, path),
              access: isPublic ? 'public' : 'session',
            });
          }
        }
      }
    }
    return routes.sort(byKey);
  }

  it('serves exactly the listed routes with the listed access', () => {
    const expected = EXPECTED_ROUTES.map(({ method, path, access }) => ({
      method,
      path,
      access,
    })).sort(byKey);

    expect(appRoutes()).toEqual(expected);
  });

  it('names a two-account test for every route with a parameter', () => {
    const listed = new Map(
      EXPECTED_ROUTES.map((route) => [routeKey(route), route]),
    );
    const sources = otherSpecSources();
    const untested = appRoutes()
      .filter((route) => route.path.includes(':'))
      .filter((route) => {
        const title = listed.get(routeKey(route))?.twoAccountTest?.trim();
        // A typo or a placeholder names no test that exists.
        return !title || !hasTestTitled(sources, title);
      })
      .map(routeKey);

    expect(untested).toEqual([]);
  });

  it('answers 401 without a cookie on every session route', async () => {
    const sessionRoutes = appRoutes().filter(
      (route) => route.access === 'session',
    );
    expect(sessionRoutes.length).toBeGreaterThan(0);

    const statuses = [];
    for (const route of sessionRoutes) {
      const path = route.path.replace(/:\w+/g, UNKNOWN_ID);
      const response =
        await http()[
          route.method.toLowerCase() as
            'get' | 'post' | 'put' | 'patch' | 'delete'
        ](path);
      statuses.push({ route: routeKey(route), status: response.status });
    }

    expect(statuses).toEqual(
      sessionRoutes.map((route) => ({ route: routeKey(route), status: 401 })),
    );
  });
});
