// Agent-loop hook at the end of the agent's turn (Stop in .claude/settings.json).
// For each app whose git state changed since the last check (also through Bash, which the
// post-edit hook does not see) it runs a fuller check: backend lint with types, tsc and the whole
// unit suite; frontend spec types and the whole unit suite in one time zone. A red result blocks
// the end of the turn once; if the agent stops again with checks still red
// (`stop_hook_active`), the user is told and the turn ends — never a second block.
// Local and recommended: two time zones, the AOT build and e2e stay in CI
// (context/foundation/test-plan.md §5). Off with SUBTRACKER_AGENT_HOOKS=off.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_DIRS, fingerprint, hooksDisabled, nodeProblem, readHookInput, runToolAsync, tail } from './lib/agent-loop.mjs';

const OUTPUT_LINES = 40;
const projectDir = path.resolve(import.meta.dirname, '..', '..');
const stateDir = path.join(import.meta.dirname, '.state');

function checksFor(app) {
  const appDir = path.join(projectDir, `${app}-subtracker`);
  const modules = path.join(appDir, 'node_modules');
  if (app === 'backend') {
    return {
      appDir,
      tools: [
        {
          name: 'oxlint --type-check',
          script: path.join(modules, 'oxlint', 'bin', 'oxlint'),
          args: ['--type-aware', '--type-check', '--quiet', 'src/', 'test/'],
        },
        { name: 'tsc', script: path.join(modules, 'typescript', 'bin', 'tsc'), args: ['-p', 'tsconfig.json', '--noEmit'] },
        { name: 'vitest run', script: path.join(modules, 'vitest', 'vitest.mjs'), args: ['run'] },
      ],
    };
  }
  return {
    appDir,
    tools: [
      {
        name: 'tsc (specs)',
        script: path.join(modules, 'typescript', 'bin', 'tsc'),
        args: ['-p', 'tsconfig.spec.json', '--noEmit'],
      },
      {
        // One zone (src/test-time-zone.spec.ts rejects any other when TZ is set); both run in CI.
        name: 'ng test',
        script: path.join(modules, '@angular', 'cli', 'bin', 'ng.js'),
        args: ['test', '--watch=false'],
        env: { TZ: 'Europe/Warsaw' },
      },
    ],
  };
}

function stateFile(app) {
  return path.join(stateDir, `stop-${app}.json`);
}

function savedState(app) {
  try {
    return JSON.parse(readFileSync(stateFile(app), 'utf8'));
  } catch {
    return {};
  }
}

async function checkApp(app) {
  const { appDir, tools } = checksFor(app);
  const failures = [];
  for (const tool of tools) {
    if (!existsSync(tool.script)) {
      failures.push({ app, tool: tool.name, output: 'tool not installed (run npm ci)' });
      continue;
    }
    const result = await runToolAsync(appDir, tool.script, tool.args, tool.env);
    if (!result.ok) failures.push({ app, tool: tool.name, output: result.output });
  }
  return failures;
}

const input = await readHookInput();
if (hooksDisabled(process.env)) process.exit(0);

const continuing = input.stop_hook_active === true;
const changed = [];
// Red results already reported for a state that has not changed since; told again only when the
// agent stops right after a block (otherwise the user would not learn the checks are still red).
const stillRed = [];
for (const app of Object.keys(APP_DIRS)) {
  const current = fingerprint(projectDir, APP_DIRS[app]);
  const saved = savedState(app);
  if (current === null || current !== saved.fingerprint) {
    changed.push({ app, fingerprint: current });
  } else if (saved.ok === false) {
    stillRed.push(...(saved.failed ?? []).map((tool) => `${app} ${tool}`));
  }
}

function tellUserStillRed(summary) {
  process.stdout.write(JSON.stringify({ systemMessage: `[agent-loop] checks still red: ${summary.join(', ')}` }));
  process.exit(0);
}

if (changed.length === 0) {
  if (continuing && stillRed.length > 0) tellUserStillRed(stillRed);
  process.exit(0);
}

const problem = nodeProblem(process.version);
if (problem) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}

const results = await Promise.all(changed.map(({ app }) => checkApp(app)));

mkdirSync(stateDir, { recursive: true });
changed.forEach(({ app, fingerprint: current }, i) => {
  if (current !== null) {
    const failed = results[i].map((f) => f.tool);
    writeFileSync(stateFile(app), JSON.stringify({ fingerprint: current, ok: failed.length === 0, failed }));
  }
});

const failures = results.flat();
if (failures.length === 0) {
  if (continuing && stillRed.length > 0) tellUserStillRed(stillRed);
  process.exit(0);
}

if (continuing) tellUserStillRed([...failures.map((f) => `${f.app} ${f.tool}`), ...stillRed]);

const report = failures
  .map((f) => `[agent-loop] ${f.app}: ${f.tool} failed\n${tail(f.output, OUTPUT_LINES)}`)
  .join('\n\n');
process.stdout.write(JSON.stringify({ decision: 'block', reason: report }));
process.exit(0);
