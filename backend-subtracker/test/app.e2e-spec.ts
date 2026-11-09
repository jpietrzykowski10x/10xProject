import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from '@nestjs/config';
import { applyHttpSecurity } from './../src/config/http-security.js';
import { type EnvConfig, envFromConfig } from './../src/config/env.js';

// Boots the full AppModule, so it needs the local PostgreSQL from .env (not run in CI).
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let allowedOrigin: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const env = envFromConfig(
      moduleFixture.get<ConfigService<EnvConfig, true>>(ConfigService),
    );
    allowedOrigin = env.CORS_ORIGINS[0];

    app = moduleFixture.createNestApplication();
    applyHttpSecurity(app, env.CORS_ORIGINS);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET) reports the database and allows the configured origin', () => {
    return request(app.getHttpServer())
      .get('/health')
      .set('Origin', allowedOrigin)
      .expect(200)
      .expect('Access-Control-Allow-Origin', allowedOrigin)
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect({ status: 'ok', db: 'ok' });
  });

  it('/health (GET) sends no CORS headers to a foreign origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://example.com')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends security headers and hides the framework', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('X-Content-Type-Options', 'nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  // deploy.sh calls /health without a cookie and rolls the deploy back when it fails.
  it('/health (GET) does not require a session', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });

  it('/auth/me (GET) answers 401 without a cookie', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('/auth/me (GET) answers 401 for an unknown session token', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', 'subtracker_session=nieznany-token')
      .expect(401);
  });

  it('/auth/logout (POST) succeeds without a session', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(204);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', 'subtracker_session=nieznany-token')
      .expect(204);
  });

  afterEach(async () => {
    await app.close();
  });
});
