import { validateEnv } from './env.js';

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
});
