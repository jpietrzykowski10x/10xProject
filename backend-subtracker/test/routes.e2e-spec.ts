import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { Public } from './../src/shared/decorators/public.decorator.js';
import { createE2eApp } from './support/e2e-app.js';

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
//   `twoAccounts()` from test/support/e2e-app.ts); put that test's name in `twoAccountTest`.
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

const ANY_ID = '00000000-0000-4000-8000-000000000000';

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

    for (const { metatype, instance } of discovery.getControllers()) {
      if (typeof metatype !== 'function' || instance === undefined) {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;
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
    const untested = appRoutes()
      .filter((route) => route.path.includes(':'))
      .filter((route) => !listed.get(routeKey(route))?.twoAccountTest?.trim())
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
      const path = route.path.replace(/:\w+/g, ANY_ID);
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
