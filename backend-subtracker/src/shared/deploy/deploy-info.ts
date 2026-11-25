import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Nest token of the deployed version, read once at startup (AppModule).
export const DEPLOYED_VERSION = Symbol('DEPLOYED_VERSION');

// What a release without .deploy-info reports: local runs, e2e and releases before the file.
export const DEV_VERSION = 'dev';

const SHA_LINE = /^SHA=(.*)$/m;
const SHA_VALUE = /^[0-9a-f]{7,40}$/;

// The commit SHA of the release in `<dir>/.deploy-info` (written by deploy.sh; the release
// directory is the working directory under forever). Only the SHA= line is read: the file also
// holds BACKUP=<dump path>, which must never reach the public /health. Anything else (no file, no
// line, a malformed value) gives `dev`.
export function readDeployedVersion(dir: string = process.cwd()): string {
  let text: string;
  try {
    text = readFileSync(join(dir, '.deploy-info'), 'utf8');
  } catch {
    return DEV_VERSION;
  }
  const value = SHA_LINE.exec(text)?.[1]?.trim();
  return value !== undefined && SHA_VALUE.test(value) ? value : DEV_VERSION;
}
