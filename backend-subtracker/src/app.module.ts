import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { type EnvConfig, envFromConfig, validateEnv } from './config/env.js';
import { buildDatabaseOptions } from './database/database.options.js';
import { HealthController } from './health/health.controller.js';

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
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
