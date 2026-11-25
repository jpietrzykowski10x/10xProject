import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDeployedVersion } from './deploy-info.js';

describe('readDeployedVersion', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'deploy-info-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const writeInfo = (text: string) =>
    writeFile(join(dir, '.deploy-info'), text, 'utf8');

  it('returns the full SHA and never the backup path', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    await writeInfo(`SHA=${sha}\nBACKUP=/home/app/backups/api-2026.sql\n`);

    expect(readDeployedVersion(dir)).toBe(sha);
  });

  it('trims the value, also with CRLF line ends', async () => {
    await writeInfo('BACKUP=\r\nSHA= 79acd8a \r\n');

    expect(readDeployedVersion(dir)).toBe('79acd8a');
  });

  it('returns dev when there is no file', () => {
    expect(readDeployedVersion(dir)).toBe('dev');
  });

  it('returns dev for a file with BACKUP but without SHA', async () => {
    await writeInfo('BACKUP=/home/app/backups/api-2026.sql\n');

    expect(readDeployedVersion(dir)).toBe('dev');
  });

  it.each([
    ['an empty value', 'SHA=\n'],
    ['garbage', 'SHA=not-a-sha; rm -rf /\n'],
    ['upper-case hex', 'SHA=0123456789ABCDEF\n'],
    ['a too short value', 'SHA=abc12\n'],
    ['a too long value', `SHA=${'a'.repeat(41)}\n`],
  ])('returns dev for %s in SHA', async (_case, text) => {
    await writeInfo(`${text}BACKUP=/home/app/backups/api-2026.sql\n`);

    expect(readDeployedVersion(dir)).toBe('dev');
  });
});
