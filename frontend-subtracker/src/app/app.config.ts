import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import localePl from '@angular/common/locales/pl';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { credentialsInterceptor } from './auth/credentials.interceptor';
import { sessionExpiredInterceptor } from './auth/session-expired.interceptor';

// Polish amounts and dates in every pipe ("1 233,87 zł", "15.11.2026"). Registered at module
// scope, so both the browser bundle (main.ts) and the server bundle (app.config.server.ts) get it.
registerLocaleData(localePl);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: LOCALE_ID, useValue: 'pl-PL' },
    provideRouter(routes),
    // The session response is per visitor: it must never be embedded in server-rendered HTML.
    provideClientHydration(
      withHttpTransferCacheOptions({ filter: (request) => !request.url.endsWith('/auth/session') }),
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([credentialsInterceptor, sessionExpiredInterceptor]),
    ),
    // Outline form fields are provided per form component (shared/form-field-defaults.ts).
  ],
};
