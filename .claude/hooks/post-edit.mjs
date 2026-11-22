// Agent-loop hook after an edit (PostToolUse, matcher Edit|Write, in .claude/settings.json).
// Checks the app whose code the edit touched (backend: oxlint --type-check + vitest related;
// frontend: ngc --noEmit for types and templates) and hands a red result back to the agent
// (stderr + exit 2) before its next step. Parallel edits run this hook in parallel; a lock per app
// and checkout makes their checks run one after another. Local and recommended: the CI gates stay
// the required ones (context/foundation/test-plan.md §5). Off with SUBTRACKER_AGENT_HOOKS=off.
// The checkout is taken from the edited file, not from where this script lives: after
// EnterWorktree, or for a subagent's worktree, $CLAUDE_PROJECT_DIR still names the main checkout.
// Files of other repositories (~/.claude, other projects) are not checked.
// PostToolBatch was tried first: there, both exit 2 and `decision: "block"` end the agent's turn
// instead of handing the report back (context/archive/2026-11-14-agent-loop-hooks/change.md, Notes).
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  acquireLock,
  checkoutOf,
  checkoutTag,
  editedFiles,
  groupByApp,
  hooksDisabled,
  nodeProblem,
  readHookInput,
  registerCheckout,
  runTool,
  sameDir,
  tail,
} from './lib/agent-loop.mjs';

const OUTPUT_LINES = 40;
// Same as `timeout` of this hook in .claude/settings.json: an older lock is orphaned.
const LOCK_STALE_MS = 60_000;
const projectDir = realpathSync.native(path.resolve(import.meta.dirname, '..', '..'));
const stateDir = path.join(import.meta.dirname, '.state');

// Messages for the user (not the agent) go to stderr with exit 1, a non-blocking hook error the
// user sees; `systemMessage` with exit 0 is not shown for PostToolUse (change.md, Notes).
function warnUser(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const input = await readHookInput();

if (hooksDisabled(process.env)) process.exit(0);

// Edited files per checkout of this repository; a relative path counts from the payload `cwd`.
const baseDir = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd();
const home = checkoutOf(projectDir);
const groups = [];
for (const raw of editedFiles(input)) {
  const file = path.resolve(baseDir, raw);
  const checkout = home ? checkoutOf(file) : { root: projectDir };
  if (!checkout || (home && !sameDir(checkout.commonDir, home.commonDir))) continue;
  const byApp = groupByApp([file], checkout.root);
  for (const app of ['backend', 'frontend']) {
    if (byApp[app].length === 0) continue;
    let group = groups.find((g) => g.app === app && sameDir(g.root, checkout.root));
    if (!group) {
      group = { app, root: checkout.root, files: [] };
      groups.push(group);
    }
    group.files.push(...byApp[app]);
  }
}
if (groups.length === 0) process.exit(0);

const problem = nodeProblem(process.version);
if (problem) warnUser(problem);

for (const { root } of groups) {
  if (!sameDir(root, projectDir)) registerCheckout(stateDir, input.session_id, root);
}

const failures = [];

function label(app, root) {
  return sameDir(root, projectDir) ? app : `${app} (${root})`;
}

function lockName(app, root) {
  return sameDir(root, projectDir) ? app : `${app}-${checkoutTag(root)}`;
}

function check(who, appDir, tool, script, args) {
  if (!existsSync(script)) {
    failures.push({ who, tool, skipped: true });
    return;
  }
  const result = runTool(appDir, script, args);
  if (!result.ok) failures.push({ who, tool, output: result.output });
}

for (const { app, root, files } of groups) {
  const appDir = path.join(root, `${app}-subtracker`);
  const modules = path.join(appDir, 'node_modules');
  const who = label(app, root);
  const release = acquireLock(stateDir, lockName(app, root), LOCK_STALE_MS);
  try {
    if (app === 'backend') {
      check(who, appDir, 'oxlint --type-check', path.join(modules, 'oxlint', 'bin', 'oxlint'), [
        '--type-aware',
        '--type-check',
        '--quiet',
        'src/',
        'test/',
      ]);
      const related = files.map((file) => path.relative(appDir, file).split(path.sep).join('/'));
      check(who, appDir, 'vitest related', path.join(modules, 'vitest', 'vitest.mjs'), ['related', '--run', ...related]);
    } else {
      // Types and templates of the whole app (tsc does not see template errors); no tests after an
      // edit — they take longer than a few seconds and run in Stop.
      const ngc = path.join(modules, '@angular', 'compiler-cli', 'bundles', 'src', 'bin', 'ngc.js');
      check(who, appDir, 'ngc --noEmit', ngc, ['-p', 'tsconfig.app.json', '--noEmit']);
    }
  } finally {
    release();
  }
}

const skipped = failures.filter((f) => f.skipped);
const red = failures.filter((f) => !f.skipped);

if (red.length > 0) {
  const report = red
    .map((f) => `[agent-loop] ${f.who}: ${f.tool} failed\n${tail(f.output, OUTPUT_LINES)}`)
    .join('\n\n');
  process.stderr.write(`${report}\n`);
  process.exit(2);
}
if (skipped.length > 0) {
  const tools = skipped.map((f) => `${f.who} ${f.tool}`).join(', ');
  warnUser(`[agent-loop] skipped (tool not installed, run npm ci): ${tools}`);
}
process.exit(0);
