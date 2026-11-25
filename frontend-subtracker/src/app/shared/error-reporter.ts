import { HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { describeError } from './error-description';

// Where a page, guard or store records the cause of an error it turns into a generic message, so
// the cause does not vanish. In the browser it is one console line (the raw error object goes only
// to the visitor's own console); on the server app.config.server.ts swaps in ServerErrorReporter,
// which writes a line of the SSR log. `context` is the name of the class or function reporting.
// Callers report only the "unknown error" branch: recognized answers (400 validation, 404, 409,
// account_blocked) are not reported. A 401 is never reported: outside /auth/ the
// session-expired interceptor already sends the visitor to /sign-in, and under /auth/ the pages
// handle it themselves.
@Injectable({ providedIn: 'root' })
export class ErrorReporter {
  report(context: string, error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status === HttpStatusCode.Unauthorized) {
      return;
    }
    this.write(context, error);
  }

  protected write(context: string, error: unknown): void {
    console.error(`[${context}] ${describeError(error)}`, error);
  }
}
