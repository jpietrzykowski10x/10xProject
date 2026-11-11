import type { INestApplication } from '@nestjs/common';
import { applyCors } from './cors.js';

// Shared by main.ts and the e2e tests, so the tests cover the production policy.
export function applyHttpSecurity(
  app: INestApplication,
  corsOrigins: string[],
): void {
  applyCors(app, corsOrigins);
  // Rejects state-changing requests a browser sends from a foreign site (403), e.g. a page that
  // auto-posts the attacker's token to /auth/verify. The frontend runs on another subdomain, so
  // its requests arrive as Sec-Fetch-Site: same-site and pass only because its origin is trusted.
  // GET, HEAD and OPTIONS, and clients without browser headers (curl, health-check), always pass.
  app.enableCsrfProtection({ trustedOrigins: corsOrigins });
  app.useSecurityHeaders();
}
