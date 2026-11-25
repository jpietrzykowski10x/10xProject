import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  appDatabaseName,
  type EnvConfig,
  envFromConfig,
  isAutoSynchronization,
} from './config/env.js';
import { applyHttpSecurity } from './config/http-security.js';
import { DEPLOYED_VERSION } from './shared/deploy/deploy-info.js';
import { AppLogger } from './shared/logging/app-logger.js';
import { highlight, plainLine } from './shared/logging/log-format.js';
import { installFatalHandlers } from './shared/process/fatal-handlers.js';

// Read raw here: the env is validated only by ConfigService, after the logger is needed.
const appName = process.env.APPLICATION_NAME ?? 'subtracker-api';

async function bootstrap() {
  // The logger is given here, so the bootstrap lines (InstanceLoader, RouterExplorer, the startup
  // runs of the jobs) already have the app's format.
  const app = await NestFactory.create(AppModule, {
    logger: new AppLogger(appName),
  });
  const env = envFromConfig(
    app.get<ConfigService<EnvConfig, true>>(ConfigService),
  );

  // No HTTPS here: the MyDevil proxy terminates TLS.
  applyHttpSecurity(app, env.CORS_ORIGINS);

  await app.listen(env.PORT);
  const version = app.get<string>(DEPLOYED_VERSION);

  new Logger('Bootstrap').log(
    highlight(
      `Started ${env.APPLICATION_NAME} version ${version} on port ${env.PORT}, mode ${env.MODE}, ` +
        `database ${appDatabaseName(env)}, auto synchronization ${isAutoSynchronization(env) ? 'YES' : 'NO'}, ` +
        `CORS origins ${env.CORS_ORIGINS.join(', ')}`,
      'info',
    ),
  );
}
// Before NestFactory.create, so a crash during startup leaves its line in the log too. Written
// without the logger (which may not exist yet), in the same format.
installFatalHandlers(
  (line) => console.error(plainLine(appName, 'FATAL', 'Process', line)),
  (code) => process.exit(code),
);
await bootstrap();
