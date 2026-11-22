// Agent-loop hook at the end of the agent's turn (Stop in .claude/settings.json).
// For each app whose git state changed since the last check (also through Bash, which the
// post-edit hook does not see) it runs a fuller check: backend lint with types, tsc and the whole
// unit suite; frontend spec types and the whole unit suite in one time zone. A red result blocks
// the end of the turn once; if the agent stops again with checks still red
// (`stop_hook_active`), the user is told and the turn ends — never a second block.
// Checkouts swept: the main one (where this script lives), the payload `cwd` (it follows
// EnterWorktree, $CLAUDE_PROJECT_DIR does not) and every worktree the post-edit hook saw edited in
// this session. Local and recommended: two time zones, the AOT build and e2e stay in CI
// (context/foundation/test-plan.md §5). Off with SUBTRACKER_AGENT_HOOKS=off.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  APP_DIRS,
  checkoutOf,
  checkoutTag,
  clearRegisteredCheckouts,
  fingerprint,
  hooksDisabled,
  nodeProblem,
  readHookInput,
  registeredCheckouts,
  runToolAsync,
  sameDir,
  tail,
} from './lib/agent-loop.mjs';

const OUTPUT_LINES = 40;
const projectDir = realpathSync.native(path.resolve(import.meta.dirname, '..', '..'));
const stateDir = path.join(import.meta.dirname, '.state');

function checksFor(app, root) {
  const appDir = path.join(root, `${app}-subtracker`);
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

function isMain(root) {
  return sameDir(root, projectDir);
}

function stateFile(app, root) {
  return path.join(stateDir, isMain(root) ? `stop-${app}.json` : `stop-${app}-${checkoutTag(root)}.json`);
}

function savedState(app, root) {
  try {
    return JSON.parse(readFileSync(stateFile(app, root), 'utf8'));
  } catch {
    return {};
  }
}

function label(app, root) {
  return isMain(root) ? app : `${app} (${root})`;
}

async function checkApp(app, root) {
  const { appDir, tools } = checksFor(app, root);
  const who = label(app, root);
  const failures = [];
  for (const tool of tools) {
    if (!existsSync(tool.script)) {
      failures.push({ who, tool: tool.name, output: 'tool not installed (run npm ci)' });
      continue;
    }
    const result = await runToolAsync(appDir, tool.script, tool.args, tool.env);
    if (!result.ok) failures.push({ who, tool: tool.name, output: result.output });
  }
  return failures;
}

const input = await readHookInput();
if (hooksDisabled(process.env)) process.exit(0);

const continuing = input.stop_hook_active === true;

// Checkouts of this repository to sweep, main first, each once.
const home = checkoutOf(projectDir);
const roots = [projectDir];
const candidates = [];
if (typeof input.cwd === 'string' && input.cwd !== '') candidates.push(input.cwd);
candidates.push(...registeredCheckouts(stateDir, input.session_id));
for (const candidate of candidates) {
  const checkout = home ? checkoutOf(candidate) : null;
  if (!checkout || !sameDir(checkout.commonDir, home.commonDir)) continue;
  if (!roots.some((r) => sameDir(r, checkout.root))) roots.push(checkout.root);
}

const changed = [];
// Red results already reported for a state that has not changed since; told again only when the
// agent stops right after a block (otherwise the user would not learn the checks are still red).
const stillRed = [];
for (const root of roots) {
  for (const app of Object.keys(APP_DIRS)) {
    const current = fingerprint(root, APP_DIRS[app]);
    const saved = savedState(app, root);
    if (current === null || current !== saved.fingerprint) {
      changed.push({ app, root, fingerprint: current });
    } else if (saved.ok === false) {
      stillRed.push(...(saved.failed ?? []).map((tool) => `${label(app, root)} ${tool}`));
    }
  }
}

function tellUserStillRed(summary) {
  process.stdout.write(JSON.stringify({ systemMessage: `[agent-loop] checks still red: ${summary.join(', ')}` }));
  process.exit(0);
}

if (changed.length === 0) {
  if (continuing && stillRed.length > 0) tellUserStillRed(stillRed);
  if (stillRed.length === 0) clearRegisteredCheckouts(stateDir, input.session_id);
  process.exit(0);
}

const problem = nodeProblem(process.version);
if (problem) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}

const results = await Promise.all(changed.map(({ app, root }) => checkApp(app, root)));

mkdirSync(stateDir, { recursive: true });
changed.forEach(({ app, root, fingerprint: current }, i) => {
  if (current !== null) {
    const failed = results[i].map((f) => f.tool);
    writeFileSync(stateFile(app, root), JSON.stringify({ fingerprint: current, ok: failed.length === 0, failed }));
  }
});

const failures = results.flat();
if (failures.length === 0) {
  if (continuing && stillRed.length > 0) tellUserStillRed(stillRed);
  // Everything swept is green: the next turn starts with an empty list of worktrees.
  if (stillRed.length === 0) clearRegisteredCheckouts(stateDir, input.session_id);
  process.exit(0);
}

if (continuing) tellUserStillRed([...failures.map((f) => `${f.who} ${f.tool}`), ...stillRed]);

const report = failures
  .map((f) => `[agent-loop] ${f.who}: ${f.tool} failed\n${tail(f.output, OUTPUT_LINES)}`)
  .join('\n\n');
process.stdout.write(JSON.stringify({ decision: 'block', reason: report }));
process.exit(0);
