import type { INestApplication } from '@nestjs/common';

// Shared by main.ts and the e2e test, so the test covers the production CORS policy.
export function applyCors(app: INestApplication, origins: string[]): void {
  app.enableCors({ origin: origins, credentials: true });
}

// Parses CORS_ORIGINS (comma-separated). The API sends credentials (session cookie from S-01),
// so only exact origins are allowed: no `*` (browsers refuse it with credentials anyway), no
// `null` (sent by sandboxed iframes and file:// pages), no paths. With requireHttps (PROD) every
// origin must be https.
export function parseCorsOrigins(
  value: string,
  requireHttps = false,
): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must list at least one origin');
  }
  for (const origin of origins) {
    assertExactOrigin(origin, requireHttps);
  }
  return origins;
}

function assertExactOrigin(origin: string, requireHttps: boolean): void {
  if (origin === '*') {
    throw new Error(
      'CORS_ORIGINS must not contain "*" (credentials are enabled)',
    );
  }
  if (origin === 'null') {
    throw new Error('CORS_ORIGINS must not contain "null"');
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`CORS_ORIGINS entry "${origin}" is not a valid origin`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`CORS_ORIGINS entry "${origin}" must use http or https`);
  }
  if (url.origin !== origin) {
    throw new Error(
      `CORS_ORIGINS entry "${origin}" must be a bare origin like "${url.origin}"`,
    );
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error(`CORS_ORIGINS entry "${origin}" must use https in PROD`);
  }
}
