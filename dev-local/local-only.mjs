// Guard shared by every script in dev-local/: they work only on the LOCAL databases.
// They read the connection from backend-subtracker/.env; the server's .env (MODE=PROD, no
// POSTGRES_DATABASE_DEV) would point them at production, so they refuse to start there.
export function assertLocalDev() {
  const problems = [];
  if (process.env.MODE !== 'DEV') problems.push('MODE is not DEV');
  if (!process.env.POSTGRES_DATABASE_DEV) problems.push('POSTGRES_DATABASE_DEV is not set');
  if (process.env.POSTGRES_DATABASE_DEV === process.env.POSTGRES_DATABASE) {
    problems.push('POSTGRES_DATABASE_DEV equals POSTGRES_DATABASE');
  }
  if (problems.length > 0) {
    console.error(`dev-local scripts run only against the local dev setup: ${problems.join('; ')}.`);
    console.error('Run them from backend-subtracker/ with: node --env-file=.env ../dev-local/<script>.mjs');
    process.exit(1);
  }
}
