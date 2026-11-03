import type { ConfigService } from '@nestjs/config';
import { assertExactOrigin, parseCorsOrigins } from './cors.js';

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
  FRONTEND_URL: string;
  SESSION_COOKIE_DOMAIN: string | undefined;
  SMTP_HOST: string | undefined;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USERNAME: string | undefined;
  SMTP_PASSWORD: string | undefined;
  SMTP_FROM_EMAIL: string | undefined;
  SMTP_FROM_NAME: string;
  NOTIFICATION_ADMINISTRATOR_MAIL: string | undefined;
  NOTIFICATION_SMTP_HOST: string | undefined;
  NOTIFICATION_SMTP_PORT: number;
  NOTIFICATION_SMTP_SECURE: boolean;
  NOTIFICATION_SMTP_USERNAME: string | undefined;
  NOTIFICATION_SMTP_PASSWORD: string | undefined;
  NOTIFICATION_SMTP_FROM_EMAIL: string | undefined;
}

type RawEnv = Record<string, unknown>;

type OptionalStringKey = {
  [K in keyof EnvConfig]: undefined extends EnvConfig[K] ? K : never;
}[keyof EnvConfig];

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

function readFrontendUrl(raw: RawEnv, mode: AppMode): string {
  const value =
    mode === 'PROD'
      ? requireString(raw, 'FRONTEND_URL')
      : (readString(raw, 'FRONTEND_URL') ?? 'http://localhost:4200');
  const origin = value.replace(/\/+$/, '');
  assertExactOrigin(origin, mode === 'PROD', 'FRONTEND_URL');
  return origin;
}

// Validates the process environment once at startup (ConfigModule `validate`) and in the
// TypeORM CLI data source.
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

  // SMTP_HOST decides whether real mail goes out: required in PROD, and in DEV its absence
  // selects the console transport. Once a host is set, its credentials are required too.
  const smtpHost =
    mode === 'PROD'
      ? requireString(raw, 'SMTP_HOST')
      : readString(raw, 'SMTP_HOST');
  const readSmtpField = (key: string): string | undefined =>
    smtpHost !== undefined ? requireString(raw, key) : undefined;

  // An empty NOTIFICATION_SMTP_HOST means operator mail uses the SMTP_* transporter.
  const notificationHost = readString(raw, 'NOTIFICATION_SMTP_HOST');
  const readNotificationField = (key: string): string | undefined =>
    notificationHost !== undefined ? requireString(raw, key) : undefined;

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
    CORS_ORIGINS: parseCorsOrigins(
      requireString(raw, 'CORS_ORIGINS'),
      mode === 'PROD',
    ),
    FRONTEND_URL: readFrontendUrl(raw, mode),
    SESSION_COOKIE_DOMAIN:
      mode === 'PROD' ? requireString(raw, 'SESSION_COOKIE_DOMAIN') : undefined,
    SMTP_HOST: smtpHost,
    SMTP_PORT: readPositiveInt(raw, 'SMTP_PORT', 587),
    SMTP_SECURE: readBoolean(raw, 'SMTP_SECURE', false),
    SMTP_USERNAME: readSmtpField('SMTP_USERNAME'),
    SMTP_PASSWORD: readSmtpField('SMTP_PASSWORD'),
    SMTP_FROM_EMAIL: readSmtpField('SMTP_FROM_EMAIL'),
    SMTP_FROM_NAME: readString(raw, 'SMTP_FROM_NAME') ?? 'SubTracker',
    NOTIFICATION_ADMINISTRATOR_MAIL:
      mode === 'PROD'
        ? requireString(raw, 'NOTIFICATION_ADMINISTRATOR_MAIL')
        : readString(raw, 'NOTIFICATION_ADMINISTRATOR_MAIL'),
    NOTIFICATION_SMTP_HOST: notificationHost,
    NOTIFICATION_SMTP_PORT: readPositiveInt(raw, 'NOTIFICATION_SMTP_PORT', 587),
    NOTIFICATION_SMTP_SECURE: readBoolean(
      raw,
      'NOTIFICATION_SMTP_SECURE',
      false,
    ),
    NOTIFICATION_SMTP_USERNAME: readNotificationField(
      'NOTIFICATION_SMTP_USERNAME',
    ),
    NOTIFICATION_SMTP_PASSWORD: readNotificationField(
      'NOTIFICATION_SMTP_PASSWORD',
    ),
    NOTIFICATION_SMTP_FROM_EMAIL: readNotificationField(
      'NOTIFICATION_SMTP_FROM_EMAIL',
    ),
  };
}

// Reads the object returned by validateEnv back from ConfigService. ConfigModule copies only
// primitive values to process.env (CORS_ORIGINS stays behind), so the app must not re-read
// process.env after startup. A key the validated object leaves undefined falls through
// ConfigService to the raw process.env, where the server scripts may have exported an empty
// value, so optional keys are normalized here: empty never reads as "configured".
export function envFromConfig(
  config: ConfigService<EnvConfig, true>,
): EnvConfig {
  const get = <K extends keyof EnvConfig>(key: K): EnvConfig[K] =>
    config.get(key, { infer: true });
  const getOptional = (key: OptionalStringKey): string | undefined =>
    get(key)?.trim() || undefined;
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
    FRONTEND_URL: get('FRONTEND_URL'),
    SESSION_COOKIE_DOMAIN:
      mode === 'PROD' ? get('SESSION_COOKIE_DOMAIN') : undefined,
    SMTP_HOST: getOptional('SMTP_HOST'),
    SMTP_PORT: get('SMTP_PORT'),
    SMTP_SECURE: get('SMTP_SECURE'),
    SMTP_USERNAME: getOptional('SMTP_USERNAME'),
    SMTP_PASSWORD: getOptional('SMTP_PASSWORD'),
    SMTP_FROM_EMAIL: getOptional('SMTP_FROM_EMAIL'),
    SMTP_FROM_NAME: get('SMTP_FROM_NAME'),
    NOTIFICATION_ADMINISTRATOR_MAIL: getOptional(
      'NOTIFICATION_ADMINISTRATOR_MAIL',
    ),
    NOTIFICATION_SMTP_HOST: getOptional('NOTIFICATION_SMTP_HOST'),
    NOTIFICATION_SMTP_PORT: get('NOTIFICATION_SMTP_PORT'),
    NOTIFICATION_SMTP_SECURE: get('NOTIFICATION_SMTP_SECURE'),
    NOTIFICATION_SMTP_USERNAME: getOptional('NOTIFICATION_SMTP_USERNAME'),
    NOTIFICATION_SMTP_PASSWORD: getOptional('NOTIFICATION_SMTP_PASSWORD'),
    NOTIFICATION_SMTP_FROM_EMAIL: getOptional('NOTIFICATION_SMTP_FROM_EMAIL'),
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
