// Agent-loop hook after an edit (PostToolUse, matcher Edit|Write, in .claude/settings.json).
// Checks the app whose code the edit touched and hands a red result back to the agent
// (stderr + exit 2) before its next step. Parallel edits run this hook in parallel; a lock per app
// makes their checks run one after another. Local and recommended: the CI gates stay the required
// ones (context/foundation/test-plan.md §5). Off with SUBTRACKER_AGENT_HOOKS=off.
// PostToolBatch was tried first: there, both exit 2 and `decision: "block"` end the agent's turn
// instead of handing the report back (context/changes/agent-loop-hooks/change.md, Notes).
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  acquireLock,
  classify,
  editedFiles,
  hooksDisabled,
  nodeProblem,
  readHookInput,
  runTool,
  tail,
} from './lib/agent-loop.mjs';

const OUTPUT_LINES = 40;
// Same as `timeout` of this hook in .claude/settings.json: an older lock is orphaned.
const LOCK_STALE_MS = 60_000;
const projectDir = path.resolve(import.meta.dirname, '..', '..');
const stateDir = path.join(import.meta.dirname, '.state');

// Messages for the user (not the agent) go to stderr with exit 1, a non-blocking hook error the
// user sees; `systemMessage` with exit 0 is not shown for PostToolUse (change.md, Notes).
function warnUser(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const input = await readHookInput();

if (hooksDisabled(process.env)) process.exit(0);

const byApp = { backend: [], frontend: [] };
for (const file of editedFiles(input)) {
  const kind = classify(file, projectDir);
  if (kind) byApp[kind.app].push(file);
}
if (byApp.backend.length === 0) process.exit(0);

const problem = nodeProblem(process.version);
if (problem) warnUser(problem);

const failures = [];

function check(app, appDir, tool, script, args) {
  if (!existsSync(script)) {
    failures.push({ app, tool, skipped: true });
    return;
  }
  const result = runTool(appDir, script, args);
  if (!result.ok) failures.push({ app, tool, output: result.output });
}

if (byApp.backend.length > 0) {
  const appDir = path.join(projectDir, 'backend-subtracker');
  const modules = path.join(appDir, 'node_modules');
  const release = acquireLock(stateDir, 'backend', LOCK_STALE_MS);
  try {
    check('backend', appDir, 'oxlint --type-check', path.join(modules, 'oxlint', 'bin', 'oxlint'), [
      '--type-aware',
      '--type-check',
      '--quiet',
      'src/',
      'test/',
    ]);
    const related = byApp.backend.map((file) => path.relative(appDir, file).split(path.sep).join('/'));
    check('backend', appDir, 'vitest related', path.join(modules, 'vitest', 'vitest.mjs'), [
      'related',
      '--run',
      ...related,
    ]);
  } finally {
    release();
  }
}

const skipped = failures.filter((f) => f.skipped);
const red = failures.filter((f) => !f.skipped);

if (red.length > 0) {
  const report = red
    .map((f) => `[agent-loop] ${f.app}: ${f.tool} failed\n${tail(f.output, OUTPUT_LINES)}`)
    .join('\n\n');
  process.stderr.write(`${report}\n`);
  process.exit(2);
}
if (skipped.length > 0) {
  const tools = skipped.map((f) => `${f.app} ${f.tool}`).join(', ');
  warnUser(`[agent-loop] skipped (tool not installed, run npm ci): ${tools}`);
}
process.exit(0);
