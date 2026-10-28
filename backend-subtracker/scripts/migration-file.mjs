// Creates a migration file in src/database/migrations/ through the TypeORM CLI.
// Run via `npm run migration:generate -- <Name>` (diff of entities vs POSTGRES_DATABASE,
// after `nest build`) or `npm run migration:create -- <Name>` (empty migration).
// The new file is formatted with prettier. TypeORM exits with code 1 and
// "No changes in database schema were found" when there is nothing to generate.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [mode, name] = process.argv.slice(2);
if ((mode !== 'generate' && mode !== 'create') || !name) {
  console.error(`Usage: npm run migration:${mode ?? 'generate'} -- <Name>`);
  process.exit(1);
}
if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
  console.error(
    `Migration name must be PascalCase letters/digits, got "${name}"`,
  );
  process.exit(1);
}

const root = join(import.meta.dirname, '..');
const migrationsDir = join(root, 'src', 'database', 'migrations');
const typeormCli = join(root, 'node_modules', 'typeorm', 'cli.js');
const prettierCli = join(
  root,
  'node_modules',
  'prettier',
  'bin',
  'prettier.cjs',
);

const listMigrations = () => new Set(readdirSync(migrationsDir));
const before = listMigrations();

const args =
  mode === 'generate'
    ? [
        'migration:generate',
        join(migrationsDir, name),
        '-d',
        join(root, 'dist', 'database', 'data-source.js'),
      ]
    : ['migration:create', join(migrationsDir, name)];

const cli = spawnSync(process.execPath, [typeormCli, ...args], {
  cwd: root,
  stdio: 'inherit',
});
if (cli.status !== 0) {
  process.exit(cli.status ?? 1);
}

const created = [...listMigrations()].filter((file) => !before.has(file));
if (created.length > 0) {
  const prettier = spawnSync(
    process.execPath,
    [
      prettierCli,
      '--write',
      ...created.map((file) => join(migrationsDir, file)),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  process.exit(prettier.status ?? 1);
}
