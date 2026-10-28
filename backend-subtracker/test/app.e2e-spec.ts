import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ConfigService } from '@nestjs/config';
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
    app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
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

  afterEach(async () => {
    await app.close();
  });
});
