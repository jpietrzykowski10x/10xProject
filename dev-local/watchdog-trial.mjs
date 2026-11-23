// Local trial of the watchdog (S-11, plan step 3.5). Not a one-off: re-run it after every change to
// src/watchdog/ or src/cli/watchdog.ts. Runs the built CLI (dist/cli/watchdog.js) once per call.
//
// Run from backend-subtracker/ after `npm run build`:
//   node --env-file=.env ../dev-local/watchdog-trial.mjs          -> one watchdog run
//   node --env-file=.env ../dev-local/watchdog-trial.mjs reset    -> forget the stored state
//
// Mail never leaves the machine: the SMTP_* and NOTIFICATION_SMTP_* variables are removed from the
// CLI's environment, so the console transport prints every mail, and the CLI runs in the working
// directory below, where no .env could bring them back. The operator address is a placeholder in
// the reserved .test domain. No database is touched.
//
// Ports: the API from PORT in .env (3000), the frontend 4200 (ng serve); override with
// WATCHDOG_API_PORT / WATCHDOG_FRONTEND_PORT. State: dev-local/.watchdog-trial/state.json
// (git-ignored).
//
// Expected with the API stopped: runs 1 and 2 print nothing about the api, run 3 prints one mail
// "SubTracker: API nie odpowiada"; after `npm run start:dev`, the next run prints one mail
// "SubTracker: API działa ponownie". The frontend is a target too: keep it running (or stopped)
// for the whole trial, or it adds its own mails.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { assertLocalDev } from './local-only.mjs';

assertLocalDev();

const workDir = join(import.meta.dirname, '.watchdog-trial');
const cli = join(process.cwd(), 'dist', 'cli', 'watchdog.js');

if (process.argv[2] === 'reset') {
  rmSync(workDir, { recursive: true, force: true });
  console.log(`State removed: ${workDir}`);
  process.exit(0);
}
mkdirSync(workDir, { recursive: true });

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('SMTP_') || key.startsWith('NOTIFICATION_SMTP_')) {
    delete env[key];
  }
}
env.NOTIFICATION_ADMINISTRATOR_MAIL = 'operator@subtracker.test';
env.WATCHDOG_API_PORT = process.env.WATCHDOG_API_PORT ?? process.env.PORT ?? '3000';
env.WATCHDOG_FRONTEND_PORT = process.env.WATCHDOG_FRONTEND_PORT ?? '4200';
env.WATCHDOG_STATE_FILE = join(workDir, 'state.json');

const result = spawnSync(process.execPath, [cli], { cwd: workDir, env, stdio: 'inherit' });
console.log(`watchdog exit code: ${result.status}; state: ${env.WATCHDOG_STATE_FILE}`);
process.exit(result.status ?? 1);
