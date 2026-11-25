import { Routes } from '@angular/router';
import { environment } from '../environments/environment';
import { adminGuard, authGuard, guestGuard } from './auth/auth.guard';
import { E2E_ROUTES } from './e2e-routes';
import { ServiceUnavailable } from './pages/service-unavailable/service-unavailable';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/register/register').then((m) => m.Register),
  },
  {
    path: 'sign-in',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/sign-in/sign-in').then((m) => m.SignIn),
  },
  {
    path: 'privacy-policy',
    loadComponent: () =>
      import('./pages/privacy-policy/privacy-policy').then((m) => m.PrivacyPolicy),
  },
  {
    path: 'auth/verify',
    loadComponent: () => import('./pages/verify-link/verify-link').then((m) => m.VerifyLink),
  },
  {
    path: 'subscriptions',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/subscriptions/subscriptions').then((m) => m.Subscriptions),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'budget',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/budget/budget').then((m) => m.Budget),
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/account/account').then((m) => m.Account),
  },
  {
    path: 'admin/users',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin-users/admin-users').then((m) => m.AdminUsers),
  },
  {
    path: 'admin/users/:id',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin-user/admin-user').then((m) => m.AdminUser),
  },
  {
    // authGuard shows this page with skipLocationChange, so the address bar keeps the guarded URL.
    // Not lazy: it is also the page shown when a lazy chunk is gone after a deploy
    // (navigation-error-handler.ts), so it must not need a chunk of its own.
    path: 'unavailable',
    component: ServiceUnavailable,
  },
  // Only in the e2e build (environment.e2e.ts); production builds have e2eRoutes: false.
  ...(environment.e2eRoutes ? E2E_ROUTES : []),
];
