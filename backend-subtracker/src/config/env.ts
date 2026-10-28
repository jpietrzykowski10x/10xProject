import type { ConfigService } from '@nestjs/config';
import { parseCorsOrigins } from './cors.js';

export type AppMode = 'DEV' | 'PROD';

export interface EnvConfig {
  APPLICATION_NAME: string;
  MODE: AppMode;
  PORT: number;
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DATABASE: string;
  POSTGRES_DATABASE_DEV: string | undefined;
  DATABASE_AUTO_SYNCHRONIZATION: boolean;
  POSTGRES_POOL_MAX: number;
  CORS_ORIGINS: string[];
}

type RawEnv = Record<string, unknown>;

function readString(raw: RawEnv, key: string): string | undefined {
  const value = raw[key];
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function requireString(raw: RawEnv, key: string): string {
  const value = readString(raw, key);
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function readPositiveInt(raw: RawEnv, key: string, fallback: number): number {
  const value = readString(raw, key);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function readBoolean(raw: RawEnv, key: string, fallback: boolean): boolean {
  const value = readString(raw, key);
  if (value === undefined) {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${key} must be "true" or "false", got "${value}"`);
}

// Validates the process environment once at startup (ConfigModule `validate`) and in the
// TypeORM CLI data source. Mail keys (SMTP_*, NOTIFICATION_*) join this list in S-01.
export function validateEnv(raw: RawEnv): EnvConfig {
  const mode = requireString(raw, 'MODE');
  if (mode !== 'DEV' && mode !== 'PROD') {
    throw new Error(`MODE must be "DEV" or "PROD", got "${mode}"`);
  }

  const autoSynchronization = readBoolean(
    raw,
    'DATABASE_AUTO_SYNCHRONIZATION',
    false,
  );
  if (mode === 'PROD' && autoSynchronization) {
    throw new Error(
      'DATABASE_AUTO_SYNCHRONIZATION=true is not allowed in PROD',
    );
  }

  const devDatabase = readString(raw, 'POSTGRES_DATABASE_DEV');
  if (mode === 'DEV' && devDatabase === undefined) {
    throw new Error(
      'Missing required environment variable POSTGRES_DATABASE_DEV (MODE=DEV)',
    );
  }

  return {
    APPLICATION_NAME: readString(raw, 'APPLICATION_NAME') ?? 'subtracker-api',
    MODE: mode,
    PORT: readPositiveInt(raw, 'PORT', 3000),
    POSTGRES_HOST: requireString(raw, 'POSTGRES_HOST'),
    POSTGRES_PORT: readPositiveInt(raw, 'POSTGRES_PORT', 5432),
    POSTGRES_USER: requireString(raw, 'POSTGRES_USER'),
    POSTGRES_PASSWORD: requireString(raw, 'POSTGRES_PASSWORD'),
    POSTGRES_DATABASE: requireString(raw, 'POSTGRES_DATABASE'),
    POSTGRES_DATABASE_DEV: mode === 'DEV' ? devDatabase : undefined,
    DATABASE_AUTO_SYNCHRONIZATION: autoSynchronization,
    POSTGRES_POOL_MAX: readPositiveInt(raw, 'POSTGRES_POOL_MAX', 5),
    CORS_ORIGINS: parseCorsOrigins(requireString(raw, 'CORS_ORIGINS')),
  };
}

// Reads the object returned by validateEnv back from ConfigService. ConfigModule copies only
// primitive values to process.env (CORS_ORIGINS stays behind), so the app must not re-read
// process.env after startup.
export function envFromConfig(
  config: ConfigService<EnvConfig, true>,
): EnvConfig {
  const get = <K extends keyof EnvConfig>(key: K): EnvConfig[K] =>
    config.get(key, { infer: true });
  const mode = get('MODE');
  return {
    APPLICATION_NAME: get('APPLICATION_NAME'),
    MODE: mode,
    PORT: get('PORT'),
    POSTGRES_HOST: get('POSTGRES_HOST'),
    POSTGRES_PORT: get('POSTGRES_PORT'),
    POSTGRES_USER: get('POSTGRES_USER'),
    POSTGRES_PASSWORD: get('POSTGRES_PASSWORD'),
    POSTGRES_DATABASE: get('POSTGRES_DATABASE'),
    POSTGRES_DATABASE_DEV:
      mode === 'DEV' ? get('POSTGRES_DATABASE_DEV') : undefined,
    DATABASE_AUTO_SYNCHRONIZATION: get('DATABASE_AUTO_SYNCHRONIZATION'),
    POSTGRES_POOL_MAX: get('POSTGRES_POOL_MAX'),
    CORS_ORIGINS: get('CORS_ORIGINS'),
  };
}

// Database the running app talks to: the -dev database in DEV, the only one in PROD.
export function appDatabaseName(env: EnvConfig): string {
  return env.MODE === 'DEV' && env.POSTGRES_DATABASE_DEV !== undefined
    ? env.POSTGRES_DATABASE_DEV
    : env.POSTGRES_DATABASE;
}

export function isAutoSynchronization(env: EnvConfig): boolean {
  return env.MODE === 'DEV' && env.DATABASE_AUTO_SYNCHRONIZATION;
}
