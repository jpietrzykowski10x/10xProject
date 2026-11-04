import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Client-rendered because of guestGuard: a prerendered form would be visible but not working
  // until the guard got its answer from the API.
  {
    path: '',
    renderMode: RenderMode.Client,
  },
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
