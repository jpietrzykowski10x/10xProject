import { RenderMode, ServerRoute } from '@angular/ssr';

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
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
