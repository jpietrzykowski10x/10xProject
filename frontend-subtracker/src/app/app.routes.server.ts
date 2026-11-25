import { RenderMode, ServerRoute } from '@angular/ssr';
import { E2E_SERVER_PATHS } from './e2e-routes';

export const serverRoutes: ServerRoute[] = [
  // The start page is the exception to "guestGuard routes are client-rendered": it is rendered on
  // the server per request, so its HTML works without JavaScript and guestGuard redirects a
  // signed-in visitor before any HTML is sent (a prerendered page flashed before the redirect).
  // The response depends on the visitor's cookie, so no cache may keep it.
  {
    path: '',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'private, no-store' },
  },
  // Client-rendered because of guestGuard: a prerendered form would be visible but not working
  // until the guard got its answer from the API.
  {
    path: 'register',
    renderMode: RenderMode.Client,
  },
  {
    path: 'sign-in',
    renderMode: RenderMode.Client,
  },
  {
    path: 'auth/verify',
    renderMode: RenderMode.Client,
  },
  {
    path: 'subscriptions',
    renderMode: RenderMode.Client,
  },
  {
    path: 'dashboard',
    renderMode: RenderMode.Client,
  },
  {
    path: 'budget',
    renderMode: RenderMode.Client,
  },
  {
    path: 'account',
    renderMode: RenderMode.Client,
  },
  // S-09: admin pages read other accounts; :id must never reach the prerender either.
  {
    path: 'admin/users',
    renderMode: RenderMode.Client,
  },
  {
    path: 'admin/users/:id',
    renderMode: RenderMode.Client,
  },
  // The e2e build's test routes (e2e-routes.e2e.ts; empty in every other build) are rendered per
  // request, never prerendered: their navigation fails on purpose.
  ...E2E_SERVER_PATHS.map((path): ServerRoute => ({ path, renderMode: RenderMode.Server })),
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
