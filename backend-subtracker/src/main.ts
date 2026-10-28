import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { applyCors } from './config/cors.js';
import {
  appDatabaseName,
  type EnvConfig,
  envFromConfig,
  isAutoSynchronization,
} from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const env = envFromConfig(
    app.get<ConfigService<EnvConfig, true>>(ConfigService),
  );

  // No HTTPS here: the MyDevil proxy terminates TLS.
  applyCors(app, env.CORS_ORIGINS);

  await app.listen(env.PORT);

  console.log(`\x1b[44m CORS ORIGINS: ${env.CORS_ORIGINS.join(', ')} \x1b[0m`);
  console.log(`\x1b[46m APP NAME: ${env.APPLICATION_NAME} \x1b[0m`);
  console.log(
    `\x1b[46m APP MODE: ${env.MODE}, CURRENT DATABASE: ${appDatabaseName(env)}, AUTO SYNCHRONIZATION: ${isAutoSynchronization(env) ? 'YES' : 'NO'}, PORT: ${env.PORT} \x1b[0m`,
  );
}
await bootstrap();
