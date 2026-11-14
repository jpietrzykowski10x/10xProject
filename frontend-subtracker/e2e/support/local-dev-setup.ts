// The e2e tests create accounts and delete rows by prefix, so every entry point (playwright.config.ts
// and the accounts helper) checks first that the environment is the local DEV setup, like
// dev-local/local-only.mjs does for the manual-test scripts.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

// Problems with the database settings in process.env (loaded from backend-subtracker/.env);
// empty when the tests may write to the database.
export function localDatabaseProblems(): string[] {
  const problems: string[] = [];
  if (process.env['MODE'] !== 'DEV') {
    problems.push(`MODE is ${process.env['MODE'] ?? 'not set'}, expected DEV`);
  }
  const host = process.env['POSTGRES_HOST'];
  if (host === undefined || !LOCAL_HOSTS.includes(host.trim())) {
    problems.push(
      `POSTGRES_HOST is ${host ?? 'not set'}, expected one of ${LOCAL_HOSTS.join(', ')}`,
    );
  }
  // Locally the reference database (subtracker-db) changes only through migrations. In CI the job
  // uses one throwaway database for both on purpose.
  const devDatabase = process.env['POSTGRES_DATABASE_DEV'];
  if (
    !process.env['CI'] &&
    devDatabase !== undefined &&
    devDatabase === process.env['POSTGRES_DATABASE']
  ) {
    problems.push(
      `POSTGRES_DATABASE_DEV equals POSTGRES_DATABASE (${devDatabase}); the tests write to the app's dev database only`,
    );
  }
  return problems;
}

export function assertLocalDatabase(): void {
  const problems = localDatabaseProblems();
  if (problems.length > 0) {
    throw new Error(`e2e tests run only against the local DEV database: ${problems.join('; ')}.`);
  }
}
