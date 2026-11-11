import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { type EnvConfig, envFromConfig, validateEnv } from './config/env.js';
import { buildDatabaseOptions } from './database/database.options.js';
import { HealthController } from './health/health.controller.js';
import { MailModule } from './mail/mail.module.js';
import { SafeLoggingExceptionFilter } from './shared/filters/safe-logging-exception.filter.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        ...buildDatabaseOptions(envFromConfig(config), 'app'),
        autoLoadEntities: true,
        // Fail fast when the database is down, so the deploy health-check notices.
        retryAttempts: 3,
        retryDelay: 3000,
      }),
    }),
    MailModule,
    UsersModule,
    AuthModule,
    SubscriptionsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // Through APP_PIPE and APP_FILTER, not main.ts, so that e2e tests booting AppModule inherit them.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: SafeLoggingExceptionFilter },
  ],
})
export class AppModule {}
