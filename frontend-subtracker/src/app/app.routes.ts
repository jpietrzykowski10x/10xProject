import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth.guard';

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
    // authGuard shows this page with skipLocationChange, so the address bar keeps the guarded URL.
    path: 'unavailable',
    loadComponent: () =>
      import('./pages/service-unavailable/service-unavailable').then((m) => m.ServiceUnavailable),
  },
];
