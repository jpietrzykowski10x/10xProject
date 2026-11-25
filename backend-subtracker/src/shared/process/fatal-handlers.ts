import type { EventEmitter } from 'node:events';
import { QueryFailedError } from 'typeorm';
import { failureCodeOf } from '../database/failure-code.js';

export type FatalKind = 'uncaughtException' | 'unhandledRejection';

// One line about an error nothing caught: its name and message only. Never the stack, the error
// object or util.inspect output, which can carry query parameters and user data. A failed query
// gets its code instead of its message, which can quote the parameters too. A thrown or rejected
// value that is not an Error is not printed at all.
export function fatalLine(kind: FatalKind, reason: unknown): string {
  if (!(reason instanceof Error)) {
    return `Fatal ${kind}: non-Error value (${typeof reason})`;
  }
  if (reason instanceof QueryFailedError) {
    return `Fatal ${kind}: QueryFailedError (code: ${failureCodeOf(reason)})`;
  }
  // Kept on one line, so the log holds one line per crash.
  const message = reason.message.replace(/\s+/g, ' ').trim();
  return `Fatal ${kind}: ${reason.name}: ${message}`;
}

// Logs an uncaught exception or an unhandled rejection in one line and ends the process with code
// 1, so a crash is no longer silent; the process manager (forever) starts it again. `target` is the
// process; tests pass their own emitter.
export function installFatalHandlers(
  log: (line: string) => void,
  exit: (code: number) => void,
  target: Pick<EventEmitter, 'on'> = process,
): void {
  const handle = (kind: FatalKind) => (reason: unknown) => {
    try {
      log(fatalLine(kind, reason));
    } finally {
      exit(1);
    }
  };
  target.on('uncaughtException', handle('uncaughtException'));
  target.on('unhandledRejection', handle('unhandledRejection'));
}
