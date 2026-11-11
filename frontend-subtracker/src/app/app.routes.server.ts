import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The start page is the exception to "guestGuard routes are client-rendered": it has no form, so
  // its prerendered HTML is useful at once, also without JavaScript. guestGuard passes during the
  // prerender; in the browser it redirects a signed-in visitor to /subscriptions after start-up.
  {
    path: '',
    renderMode: RenderMode.Prerender,
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
