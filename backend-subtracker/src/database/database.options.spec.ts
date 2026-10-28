import { validateEnv } from '../config/env.js';
import { buildDatabaseOptions } from './database.options.js';

const devEnv = validateEnv({
  MODE: 'DEV',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'subtracker-adm',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DATABASE: 'subtracker-db',
  POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
  DATABASE_AUTO_SYNCHRONIZATION: 'true',
  CORS_ORIGINS: 'http://localhost:4200',
});

const prodEnv = validateEnv({
  MODE: 'PROD',
  POSTGRES_HOST: 'pgsql0.mydevil.net',
  POSTGRES_USER: 'p_subtracker',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DATABASE: 'p_subtracker',
  CORS_ORIGINS: 'https://subtracker.jakubpietrzykowski.pl',
});

describe('buildDatabaseOptions', () => {
  it('app in DEV uses the -dev database and the synchronize flag', () => {
    const options = buildDatabaseOptions(devEnv, 'app');
    expect(options.database).toBe('subtracker-db-dev');
    expect(options.synchronize).toBe(true);
  });

  it('app in DEV without the flag does not synchronize', () => {
    const options = buildDatabaseOptions(
      { ...devEnv, DATABASE_AUTO_SYNCHRONIZATION: false },
      'app',
    );
    expect(options.synchronize).toBe(false);
  });

  it('app in PROD uses POSTGRES_DATABASE without synchronize', () => {
    const options = buildDatabaseOptions(prodEnv, 'app');
    expect(options.database).toBe('p_subtracker');
    expect(options.synchronize).toBe(false);
  });

  it('cli always targets POSTGRES_DATABASE without synchronize', () => {
    const options = buildDatabaseOptions(devEnv, 'cli');
    expect(options.database).toBe('subtracker-db');
    expect(options.synchronize).toBe(false);
    expect(options.entities).toEqual([
      expect.stringMatching(/!\(node_modules\)[\\/]\*\*[\\/]\*\.entity\.js$/),
    ]);
  });

  it('shares migration settings between targets', () => {
    for (const options of [
      buildDatabaseOptions(prodEnv, 'app'),
      buildDatabaseOptions(prodEnv, 'cli'),
    ]) {
      expect(options).toMatchObject({
        type: 'postgres',
        migrationsRun: false,
        migrationsTableName: 'migration_history',
        migrationsTransactionMode: 'all',
        uuidExtension: 'pgcrypto',
        extra: { max: 5 },
      });
      expect(options.migrations).toEqual([
        expect.stringMatching(/migrations[\\/]\*\.js$/),
      ]);
    }
  });
});
