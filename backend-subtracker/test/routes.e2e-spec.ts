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
import { Roles } from './../src/shared/decorators/roles.decorator.js';
import { RoleCode } from './../src/shared/types/role-code.js';
import { grantAdmin } from './../src/users/role-grants.js';
import { createE2eApp, UNKNOWN_ID } from './support/e2e-app.js';

// `admin`: a session with ADMIN or SUPER_ADMIN (@Roles on the handler or controller).
type Access = 'public' | 'session' | 'admin';

// The only role set a route may require: every admin route is open to both admin roles.
const ADMIN_ROUTE_ROLES = [RoleCode.ADMIN, RoleCode.SUPER_ADMIN].sort();

// The test of the rank rule (test/admin/admin-users.e2e-spec.ts), which stands in for the
// two-account test on the admin routes with a parameter: there every admin reaches every account
// by design, and the rule is who may change whom.
const RANK_MATRIX_TEST =
  'refuses every admin action where the actor does not outrank the target, leaving the target unchanged';

interface ExpectedRoute {
  method: string;
  path: string;
  access: Access;
  // The name of the test where a second account is refused this route's resource; for an
  // `admin` route the rank matrix test.
  twoAccountTest?: string;
}

interface AppRoute {
  method: string;
  path: string;
  access: Access;
}

// Every route the API serves. A new route fails this file until it is added here on purpose:
// - `session` unless the handler or controller carries @Public(), `admin` when it carries
//   @Roles([ADMIN, SUPER_ADMIN]) (any other role set fails this file);
// - a route with a parameter in its path (e.g. `/subscriptions/:id`) also needs a test that a
//   second account gets no access to the owner's resource (two-account pattern, test plan §6.4,
//   `twoAccounts()` from test/support/e2e-app.ts, example in
//   test/subscriptions/account-isolation.e2e-spec.ts); put that test's name in `twoAccountTest`.
//   An `admin` route with a parameter names the rank matrix test instead.
const EXPECTED_ROUTES: ExpectedRoute[] = [
  { method: 'GET', path: '/', access: 'public' },
  { method: 'GET', path: '/admin/users', access: 'admin' },
  {
    method: 'GET',
    path: '/admin/users/:id',
    access: 'admin',
    twoAccountTest: RANK_MATRIX_TEST,
  },
  {
    method: 'POST',
    path: '/admin/users/:id/block',
    access: 'admin',
    twoAccountTest: RANK_MATRIX_TEST,
  },
  {
    method: 'POST',
    path: '/admin/users/:id/unblock',
    access: 'admin',
    twoAccountTest: RANK_MATRIX_TEST,
  },
  {
    method: 'POST',
    path: '/admin/users/:id/reset-sessions',
    access: 'admin',
    twoAccountTest: RANK_MATRIX_TEST,
  },
  { method: 'GET', path: '/health', access: 'public' },
  { method: 'POST', path: '/auth/register', access: 'public' },
  { method: 'POST', path: '/auth/request-link', access: 'public' },
  { method: 'POST', path: '/auth/verify', access: 'public' },
  { method: 'GET', path: '/auth/session', access: 'public' },
  { method: 'GET', path: '/auth/me', access: 'session' },
  { method: 'POST', path: '/auth/logout', access: 'public' },
  { method: 'POST', path: '/auth/delete-account', access: 'session' },
  { method: 'GET', path: '/budget', access: 'session' },
  { method: 'PUT', path: '/budget', access: 'session' },
  { method: 'GET', path: '/categories', access: 'session' },
  { method: 'POST', path: '/categories', access: 'session' },
  {
    method: 'PATCH',
    path: '/categories/:id',
    access: 'session',
    twoAccountTest:
      "lets no account rename or delete another account's category",
  },
  {
    method: 'DELETE',
    path: '/categories/:id',
    access: 'session',
    twoAccountTest:
      "lets no account rename or delete another account's category",
  },
  { method: 'GET', path: '/subscriptions', access: 'session' },
  { method: 'POST', path: '/subscriptions', access: 'session' },
  { method: 'GET', path: '/subscriptions/totals', access: 'session' },
  {
    method: 'PUT',
    path: '/subscriptions/:id',
    access: 'session',
    twoAccountTest:
      "lets no account change or delete another account's subscription",
  },
  {
    method: 'DELETE',
    path: '/subscriptions/:id',
    access: 'session',
    twoAccountTest:
      "lets no account change or delete another account's subscription",
  },
  {
    method: 'POST',
    path: '/subscriptions/:id/cancel',
    access: 'session',
    twoAccountTest:
      "lets no account cancel or resume another account's subscription",
  },
  {
    method: 'POST',
    path: '/subscriptions/:id/resume',
    access: 'session',
    twoAccountTest:
      "lets no account cancel or resume another account's subscription",
  },
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

// A role set other than ADMIN_ROUTE_ROLES, or roles on a public route, is a mistake this file
// refuses rather than a new kind of access.
function accessOf(
  handlerName: string,
  isPublic: boolean | undefined,
  roles: RoleCode[] | undefined,
): Access {
  if (roles === undefined) {
    return isPublic ? 'public' : 'session';
  }
  const required = [...roles].sort();
  if (
    isPublic ||
    required.length !== ADMIN_ROUTE_ROLES.length ||
    required.some((role, index) => role !== ADMIN_ROUTE_ROLES[index])
  ) {
    throw new Error(
      `${handlerName} requires roles [${required.join(', ')}]${isPublic ? ' on a public route' : ''}; admin routes require [${ADMIN_ROUTE_ROLES.join(', ')}]`,
    );
  }
  return 'admin';
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
        // Read the same way as SessionAuthGuard and RolesGuard do.
        const isPublic = reflector.getAllAndOverride(Public, [
          handler,
          metatype,
        ]);
        const roles: RoleCode[] | undefined = reflector.getAllAndOverride(
          Roles,
          [handler, metatype],
        );
        const access = accessOf(
          `${String(controllerName)}.${name}`,
          isPublic,
          roles,
        );
        for (const controllerPath of controllerPaths) {
          for (const path of pathsOf(handlerPath)) {
            routes.push({
              method,
              path: joinPath(controllerPath, path),
              access,
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

  // Every route of the access, called with UNKNOWN_ID for each parameter and the cookie if any.
  async function statusesOf(access: Access, cookie?: string) {
    const routes = appRoutes().filter((route) => route.access === access);
    expect(routes.length).toBeGreaterThan(0);

    const statuses = [];
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, UNKNOWN_ID);
      const call =
        http()[
          route.method.toLowerCase() as
            'get' | 'post' | 'put' | 'patch' | 'delete'
        ](path);
      const response = await (cookie === undefined
        ? call
        : call.set('Cookie', cookie));
      statuses.push({ route: routeKey(route), status: response.status });
    }
    return { routes, statuses };
  }

  const expectAll = (routes: AppRoute[], status: number) =>
    routes.map((route) => ({ route: routeKey(route), status }));

  it.each<Access>(['session', 'admin'])(
    'answers 401 without a cookie on every %s route',
    async (access) => {
      const { routes, statuses } = await statusesOf(access);

      expect(statuses).toEqual(expectAll(routes, 401));
    },
  );

  it('answers 403 to a session without an admin role on every admin route', async () => {
    const { cookie } = await e2e.signIn();

    const { routes, statuses } = await statusesOf('admin', cookie);

    expect(statuses).toEqual(expectAll(routes, 403));
  });

  // The other side of the test above: the 403 comes from the role, not from something else on the
  // route. UNKNOWN_ID gives an admin 404 on the routes with a parameter.
  it('lets an admin session through on every admin route', async () => {
    const { address, cookie } = await e2e.signIn();
    await grantAdmin(e2e.dataSource, address);

    const { statuses } = await statusesOf('admin', cookie);

    expect(
      statuses.every(({ status }) => status !== 401 && status !== 403),
    ).toBe(true);
  });
});
