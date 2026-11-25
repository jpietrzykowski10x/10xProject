import { inject, Injectable, REQUEST } from '@angular/core';
import { safePath, serverLine } from '../server-log';
import { describeError } from './shared/error-description';
import { ErrorReporter } from './shared/error-reporter';

// ErrorReporter on the server (app.config.server.ts only, so server-log.ts stays out of the browser
// bundle): one ERROR line of the SSR log in the S-14 format, with the method and the path of the
// request being rendered, never its query. Prerendering at build time has no request: `- -`.
@Injectable()
export class ServerErrorReporter extends ErrorReporter {
  private readonly request = inject(REQUEST, { optional: true });

  protected override write(context: string, error: unknown): void {
    const method = this.request?.method ?? '-';
    const path = this.request ? safePath(new URL(this.request.url).pathname) : '-';
    console.error(serverLine('ERROR', context, `${method} ${path} ${describeError(error)}`));
  }
}
