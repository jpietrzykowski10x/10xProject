import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { ServerErrorReporter } from './server-error-reporter';
import { ErrorReporter } from './shared/error-reporter';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Reported errors go to the SSR log (S-14 format) instead of a bare console line.
    { provide: ErrorReporter, useClass: ServerErrorReporter },
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
