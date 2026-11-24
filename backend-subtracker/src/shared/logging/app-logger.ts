import { ConsoleLogger } from '@nestjs/common';
import { APP_TIME_ZONE } from '../date/calendar-day.js';
import { colorsEnabled, isoTimestampIn, safeStack } from './log-format.js';

// The API's logger, given to NestFactory.create so every line from the first one has the same
// format: `[<app>] <pid>  - <ISO time in APP_TIME_ZONE> <LEVEL> [<Context>] <message>`. Colours
// only in a terminal (colorsEnabled), so out.log and err.log under forever carry no escape codes.
// A stack of a QueryFailedError is written without the error's message (safeStack). Code keeps
// using `new Logger(Context)`, which delegates here.
export class AppLogger extends ConsoleLogger {
  constructor(appName: string) {
    super({ prefix: appName, colors: colorsEnabled() });
  }

  protected override getTimestamp(): string {
    return isoTimestampIn(APP_TIME_ZONE, new Date());
  }

  protected override printStackTrace(stack: string): void {
    // Nest passes undefined when a line has no stack; the parent skips it.
    super.printStackTrace(typeof stack === 'string' ? safeStack(stack) : stack);
  }
}
