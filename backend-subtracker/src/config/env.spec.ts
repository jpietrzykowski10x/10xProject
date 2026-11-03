import { ConfigService } from '@nestjs/config';
import { type EnvConfig, envFromConfig, validateEnv } from './env.js';

const devEnv = {
  MODE: 'DEV',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'subtracker-adm',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DATABASE: 'subtracker-db',
  POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
  CORS_ORIGINS: 'http://localhost:4200',
};

const prodEnv = {
  ...devEnv,
  MODE: 'PROD',
  POSTGRES_DATABASE_DEV: undefined,
  CORS_ORIGINS: 'https://subtracker.jakubpietrzykowski.pl',
  FRONTEND_URL: 'https://subtracker.jakubpietrzykowski.pl',
  SESSION_COOKIE_DOMAIN: '.jakubpietrzykowski.pl',
  SMTP_HOST: 'mail.example.com',
  SMTP_USERNAME: 'noreply@example.com',
  SMTP_PASSWORD: 'smtp-secret',
  SMTP_FROM_EMAIL: 'noreply@example.com',
  NOTIFICATION_ADMINISTRATOR_MAIL: 'operator@example.com',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(devEnv);
    expect(env.APPLICATION_NAME).toBe('subtracker-api');
    expect(env.PORT).toBe(3000);
    expect(env.POSTGRES_PORT).toBe(5432);
    expect(env.POSTGRES_POOL_MAX).toBe(5);
    expect(env.DATABASE_AUTO_SYNCHRONIZATION).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200']);
  });

  it('parses numbers and booleans', () => {
    const env = validateEnv({
      ...devEnv,
      PORT: '59663',
      POSTGRES_PORT: '5433',
      POSTGRES_POOL_MAX: '2',
      DATABASE_AUTO_SYNCHRONIZATION: 'true',
    });
    expect(env.PORT).toBe(59663);
    expect(env.POSTGRES_PORT).toBe(5433);
    expect(env.POSTGRES_POOL_MAX).toBe(2);
    expect(env.DATABASE_AUTO_SYNCHRONIZATION).toBe(true);
  });

  it('requires POSTGRES_HOST', () => {
    expect(() => validateEnv({ ...devEnv, POSTGRES_HOST: undefined })).toThrow(
      /POSTGRES_HOST/,
    );
  });

  it('requires CORS_ORIGINS', () => {
    expect(() => validateEnv({ ...devEnv, CORS_ORIGINS: '' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('rejects an unknown MODE', () => {
    expect(() => validateEnv({ ...devEnv, MODE: 'TEST' })).toThrow(/MODE/);
  });

  it('requires POSTGRES_DATABASE_DEV in DEV', () => {
    expect(() =>
      validateEnv({ ...devEnv, POSTGRES_DATABASE_DEV: undefined }),
    ).toThrow(/POSTGRES_DATABASE_DEV/);
  });

  it('ignores POSTGRES_DATABASE_DEV in PROD', () => {
    const env = validateEnv({ ...prodEnv, POSTGRES_DATABASE_DEV: 'x-dev' });
    expect(env.POSTGRES_DATABASE_DEV).toBeUndefined();
  });

  it('rejects auto synchronization in PROD', () => {
    expect(() =>
      validateEnv({ ...prodEnv, DATABASE_AUTO_SYNCHRONIZATION: 'true' }),
    ).toThrow(/not allowed in PROD/);
  });

  it('rejects a malformed number', () => {
    expect(() => validateEnv({ ...devEnv, POSTGRES_POOL_MAX: 'five' })).toThrow(
      /POSTGRES_POOL_MAX/,
    );
  });

  it('rejects a plain http origin in PROD', () => {
    expect(() =>
      validateEnv({
        ...prodEnv,
        CORS_ORIGINS: 'http://subtracker.jakubpietrzykowski.pl',
      }),
    ).toThrow(/https in PROD/);
  });

  it('applies mail defaults in DEV without SMTP', () => {
    const env = validateEnv(devEnv);
    expect(env.FRONTEND_URL).toBe('http://localhost:4200');
    expect(env.SESSION_COOKIE_DOMAIN).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.SMTP_FROM_NAME).toBe('SubTracker');
    expect(env.NOTIFICATION_ADMINISTRATOR_MAIL).toBeUndefined();
    expect(env.NOTIFICATION_SMTP_HOST).toBeUndefined();
  });

  it('accepts a complete PROD environment', () => {
    const env = validateEnv(prodEnv);
    expect(env.FRONTEND_URL).toBe('https://subtracker.jakubpietrzykowski.pl');
    expect(env.SESSION_COOKIE_DOMAIN).toBe('.jakubpietrzykowski.pl');
    expect(env.SMTP_HOST).toBe('mail.example.com');
  });

  it.each([
    'FRONTEND_URL',
    'SESSION_COOKIE_DOMAIN',
    'SMTP_HOST',
    'SMTP_USERNAME',
    'SMTP_PASSWORD',
    'SMTP_FROM_EMAIL',
    'NOTIFICATION_ADMINISTRATOR_MAIL',
  ])('requires %s in PROD', (key) => {
    expect(() => validateEnv({ ...prodEnv, [key]: '' })).toThrow(
      new RegExp(`Missing required environment variable ${key}`),
    );
  });

  it('ignores SESSION_COOKIE_DOMAIN in DEV', () => {
    const env = validateEnv({
      ...devEnv,
      SESSION_COOKIE_DOMAIN: '.example.com',
    });
    expect(env.SESSION_COOKIE_DOMAIN).toBeUndefined();
  });

  it('requires https for FRONTEND_URL in PROD', () => {
    expect(() =>
      validateEnv({ ...prodEnv, FRONTEND_URL: 'http://example.com' }),
    ).toThrow(/FRONTEND_URL.*https in PROD/);
  });

  it('rejects a FRONTEND_URL with a path', () => {
    expect(() =>
      validateEnv({ ...devEnv, FRONTEND_URL: 'http://localhost:4200/app' }),
    ).toThrow(/FRONTEND_URL.*bare origin/);
  });

  it('strips a trailing slash from FRONTEND_URL', () => {
    const env = validateEnv({
      ...devEnv,
      FRONTEND_URL: 'http://localhost:4200/',
    });
    expect(env.FRONTEND_URL).toBe('http://localhost:4200');
  });

  it('requires the SMTP credentials once SMTP_HOST is set in DEV', () => {
    expect(() =>
      validateEnv({ ...devEnv, SMTP_HOST: 'mail.example.com' }),
    ).toThrow(/SMTP_USERNAME/);
  });

  it('treats an empty NOTIFICATION_SMTP_HOST as no separate transporter', () => {
    const env = validateEnv({
      ...prodEnv,
      NOTIFICATION_SMTP_HOST: '',
      NOTIFICATION_SMTP_USERNAME: 'leftover',
    });
    expect(env.NOTIFICATION_SMTP_HOST).toBeUndefined();
    expect(env.NOTIFICATION_SMTP_USERNAME).toBeUndefined();
  });

  it.each([
    'NOTIFICATION_SMTP_USERNAME',
    'NOTIFICATION_SMTP_PASSWORD',
    'NOTIFICATION_SMTP_FROM_EMAIL',
  ])('requires %s once NOTIFICATION_SMTP_HOST is set', (key) => {
    const complete = {
      ...devEnv,
      NOTIFICATION_SMTP_HOST: 'alerts.example.com',
      NOTIFICATION_SMTP_USERNAME: 'alerts@example.com',
      NOTIFICATION_SMTP_PASSWORD: 'alerts-secret',
      NOTIFICATION_SMTP_FROM_EMAIL: 'alerts@example.com',
    };
    expect(validateEnv(complete).NOTIFICATION_SMTP_PORT).toBe(587);
    expect(() => validateEnv({ ...complete, [key]: '' })).toThrow(
      new RegExp(key),
    );
  });
});

describe('envFromConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ConfigService falls through to process.env for keys the validated object leaves undefined.
  it('does not read an empty exported variable as configured', () => {
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('NOTIFICATION_SMTP_HOST', ' ');
    vi.stubEnv('NOTIFICATION_ADMINISTRATOR_MAIL', '');
    const env = envFromConfig(
      new ConfigService<EnvConfig, true>(validateEnv(devEnv)),
    );
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.NOTIFICATION_SMTP_HOST).toBeUndefined();
    expect(env.NOTIFICATION_ADMINISTRATOR_MAIL).toBeUndefined();
  });

  it('does not read SESSION_COOKIE_DOMAIN from process.env in DEV', () => {
    vi.stubEnv('SESSION_COOKIE_DOMAIN', '.example.com');
    const env = envFromConfig(
      new ConfigService<EnvConfig, true>(validateEnv(devEnv)),
    );
    expect(env.SESSION_COOKIE_DOMAIN).toBeUndefined();
  });
});
