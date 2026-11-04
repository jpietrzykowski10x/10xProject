import type { INestApplication } from '@nestjs/common';
import { applyCors } from './cors.js';

// Shared by main.ts and the e2e tests, so the tests cover the production policy.
export function applyHttpSecurity(
  app: INestApplication,
  corsOrigins: string[],
): void {
  applyCors(app, corsOrigins);
  app.useSecurityHeaders();
}
