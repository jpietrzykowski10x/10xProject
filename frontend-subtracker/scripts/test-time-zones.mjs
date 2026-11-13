// Runs the whole unit test suite once per time zone: one east of Greenwich (Warsaw) and one west
// of it (New York). Date bugs that shift a day only show up off UTC, and each direction catches a
// different one, while CI runners default to UTC. Run via `npm run test:ci`.
// TZ goes into the child's environment before it starts (a `TZ=... ng test` prefix would not work
// on Windows); src/test-time-zone.spec.ts proves it reached the test code.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const TIME_ZONES = ['Europe/Warsaw', 'America/New_York'];

const root = join(import.meta.dirname, '..');
const ng = join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

// Every zone runs even after a failure, so one red zone does not hide the result of the other.
const failed = [];
for (const timeZone of TIME_ZONES) {
  console.log(`\n=== Unit tests in time zone ${timeZone} ===\n`);
  const run = spawnSync(process.execPath, [ng, 'test', '--watch=false'], {
    cwd: root,
    env: { ...process.env, TZ: timeZone },
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    failed.push(timeZone);
  }
}

if (failed.length > 0) {
  console.error(`\nUnit tests failed in: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\nUnit tests passed in: ${TIME_ZONES.join(', ')}`);
