// DataSource for the TypeORM CLI (migration:run|revert|show|generate). The CLI does not boot
// Nest, so the environment is read directly: .env is loaded when present (locally); on the
// server start-app.sh / deploy.sh have already exported the variables.
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.js';
import { buildDatabaseOptions } from './database.options.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default new DataSource(
  buildDatabaseOptions(validateEnv(process.env), 'cli'),
);
