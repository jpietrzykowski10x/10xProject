import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { type EnvConfig, envFromConfig, validateEnv } from './config/env.js';
import { buildDatabaseOptions } from './database/database.options.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MailModule } from './mail/mail.module.js';
import {
  DEPLOYED_VERSION,
  readDeployedVersion,
} from './shared/deploy/deploy-info.js';
import { SafeLoggingExceptionFilter } from './shared/filters/safe-logging-exception.filter.js';
import { LoggingValidationPipe } from './shared/validation/validation-pipe.js';
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
    // Cron jobs of the feature modules (e.g. the subscription lifecycle job).
    ScheduleModule.forRoot(),
    MailModule,
    UsersModule,
    AuthModule,
    SubscriptionsModule,
    AdminModule,
    // JobRunService for the job state in /health.
    JobsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // Read once at startup, for the start line in main.ts and /health.
    { provide: DEPLOYED_VERSION, useFactory: () => readDeployedVersion() },
    // Through APP_PIPE and APP_FILTER, not main.ts, so that e2e tests booting AppModule inherit them.
    // The pipe is Nest's ValidationPipe whose 400 also names the refused fields in the log.
    {
      provide: APP_PIPE,
      useValue: new LoggingValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: SafeLoggingExceptionFilter },
  ],
})
export class AppModule {}
