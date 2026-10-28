// Parses CORS_ORIGINS (comma-separated). The API sends credentials (session cookie from S-01),
// so a wildcard is rejected: browsers refuse `*` together with credentials anyway.
export function parseCorsOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must list at least one origin');
  }
  if (origins.includes('*')) {
    throw new Error(
      'CORS_ORIGINS must not contain "*" (credentials are enabled)',
    );
  }
  return origins;
}
