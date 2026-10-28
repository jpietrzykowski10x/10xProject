import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import {
  appDatabaseName,
  type EnvConfig,
  isAutoSynchronization,
} from '../config/env.js';

export type DatabaseTarget = 'app' | 'cli';

// Paths are resolved relative to this file, so they hold both in dist/ and in the flattened
// .mydevil/ package, whatever the working directory.
const databaseDir = import.meta.dirname;

const CONNECT_TIMEOUT_MS = 5000;
const APP_STATEMENT_TIMEOUT_MS = 5000;

// Single source of connection options for the Nest app and the TypeORM CLI.
// The app uses the -dev database in DEV (optionally synchronized); the CLI always targets
// POSTGRES_DATABASE, the reference database locally and the only database in production.
export function buildDatabaseOptions(
  env: EnvConfig,
  target: DatabaseTarget,
): DataSourceOptions {
  const common = {
    type: 'postgres' as const,
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    migrations: [join(databaseDir, 'migrations', '*.js')],
    migrationsTableName: 'migration_history',
    migrationsTransactionMode: 'all' as const,
    migrationsRun: false,
    uuidExtension: 'pgcrypto' as const,
    // Also bounds the wait for a free client when the pool is exhausted.
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    extra: { max: env.POSTGRES_POOL_MAX },
  };

  if (target === 'app') {
    return {
      ...common,
      database: appDatabaseName(env),
      synchronize: isAutoSynchronization(env),
      // A stalled database makes /health answer 503 instead of hanging. App only:
      // migrations may legitimately run longer, so the cli target has no limit.
      extra: { ...common.extra, statement_timeout: APP_STATEMENT_TIMEOUT_MS },
    };
  }

  return {
    ...common,
    database: env.POSTGRES_DATABASE,
    synchronize: false,
    // In .mydevil/ the parent directory is the release root next to node_modules;
    // excluding it keeps the CLI from scanning (and loading) foreign *.entity.js files.
    entities: [join(databaseDir, '..', '!(node_modules)', '**', '*.entity.js')],
  };
}
