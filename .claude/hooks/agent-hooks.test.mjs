// End-to-end proof of the agent-loop hooks: post-edit.mjs and stop.mjs run as Claude Code runs
// them (JSON payload on stdin, exit code + stderr/stdout read back) inside a throwaway git repo
// with the same layout as this one. Real git, real scripts; only the tools are stubs (they fail
// when a file of the app contains HOOK_BROKEN), because oxlint, vitest, ngc and ng test are slow
// and need the real apps. Pure helpers are covered by lib/agent-loop.test.mjs.
// Run from the repo root: node --test ".claude/hooks/**/*.test.mjs" (also a step of CI job `backend`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const HOOKS = import.meta.dirname;
const MARKER = 'HOOK_BROKEN';

// A tool stub: lists every file of the app (cwd) holding the marker and fails, like a linter.
const STUB = `import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const bad = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (readFileSync(full, 'utf8').includes('${MARKER}')) bad.push(path.relative(process.cwd(), full).split(path.sep).join('/'));
  }
}
walk(process.cwd());
for (const file of bad) console.log(file + ': ${MARKER} found');
process.exit(bad.length ? 1 : 0);
`;

const TOOLS = {
  backend: ['oxlint/bin/oxlint', 'vitest/vitest.mjs', 'typescript/bin/tsc'],
  frontend: ['@angular/compiler-cli/bundles/src/bin/ngc.js', 'typescript/bin/tsc', '@angular/cli/bin/ng.js'],
};

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
}

function write(root, rel, content) {
  const file = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function installStubs(root, { without = [] } = {}) {
  for (const [app, tools] of Object.entries(TOOLS)) {
    for (const tool of tools) {
      if (!without.includes(tool)) write(root, `${app}-subtracker/node_modules/${tool}`, STUB);
    }
  }
}

/** A committed repo with both apps, the hook scripts and the tool stubs. */
function makeRepo() {
  const root = tempDir('agent-hooks-');
  for (const rel of ['post-edit.mjs', 'stop.mjs', 'lib/agent-loop.mjs']) {
    mkdirSync(path.join(root, '.claude', 'hooks', 'lib'), { recursive: true });
    copyFileSync(path.join(HOOKS, ...rel.split('/')), path.join(root, '.claude', 'hooks', ...rel.split('/')));
  }
  write(root, '.gitignore', 'node_modules/\n.claude/hooks/.state/\n');
  write(root, 'README.md', '# test\n');
  write(root, 'backend-subtracker/package.json', '{}\n');
  write(root, 'backend-subtracker/src/ok.ts', 'export const ok = 1;\n');
  write(root, 'frontend-subtracker/package.json', '{}\n');
  write(root, 'frontend-subtracker/src/app.ts', 'export const app = 1;\n');
  installStubs(root);
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

const ENV = { ...process.env, CLAUDE_PROJECT_DIR: path.join(tmpdir(), 'does-not-exist') };
delete ENV.SUBTRACKER_AGENT_HOOKS;
delete ENV.NODE_TEST_CONTEXT;

function hook(root, script, payload) {
  const run = spawnSync(process.execPath, [path.join(root, '.claude', 'hooks', script)], {
    cwd: root,
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: ENV,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const edit = (file, extra = {}) => ({ tool_name: 'Edit', tool_input: { file_path: file }, ...extra });
const stop = (root, extra = {}) => ({ hook_event_name: 'Stop', cwd: root, stop_hook_active: false, ...extra });
const decision = (stdout) => (stdout ? JSON.parse(stdout) : {});

describe('post-edit.mjs', () => {
  const root = makeRepo();

  it('hands a red check back to the agent (exit 2, stderr names file and problem)', () => {
    const file = write(root, 'backend-subtracker/src/broken.ts', `// ${MARKER}\n`);
    try {
      const run = hook(root, 'post-edit.mjs', edit(file));
      assert.equal(run.status, 2);
      assert.match(run.stderr, /\[agent-loop\] backend: oxlint --type-check failed/);
      assert.match(run.stderr, /src\/broken\.ts: HOOK_BROKEN found/);
    } finally {
      rmSync(file);
    }
  });

  it('checks the frontend with ngc', () => {
    const file = write(root, 'frontend-subtracker/src/broken.html', `<p>${MARKER}</p>\n`);
    try {
      const run = hook(root, 'post-edit.mjs', edit(file));
      assert.equal(run.status, 2);
      assert.match(run.stderr, /frontend: ngc --noEmit failed/);
    } finally {
      rmSync(file);
    }
  });

  it('passes silently on a clean file', () => {
    const run = hook(root, 'post-edit.mjs', edit(path.join(root, 'backend-subtracker', 'src', 'ok.ts')));
    assert.equal(run.status, 0);
    assert.equal(run.stderr, '');
  });

  it('does not check a file type outside the checks, even with an error in the app', () => {
    const broken = write(root, 'backend-subtracker/src/broken.ts', `// ${MARKER}\n`);
    try {
      for (const rel of ['README.md', 'backend-subtracker/README.md', 'frontend-subtracker/src/x.spec.ts']) {
        const run = hook(root, 'post-edit.mjs', edit(path.join(root, ...rel.split('/'))));
        assert.equal(run.status, 0, rel);
      }
    } finally {
      rmSync(broken);
    }
  });

  it('passes for a file that does not exist (deleted or never written)', () => {
    const run = hook(root, 'post-edit.mjs', edit(path.join(root, 'backend-subtracker', 'src', 'gone.ts')));
    assert.equal(run.status, 0, run.stderr);
  });

  it('passes on an empty, broken or path-less payload', () => {
    for (const payload of ['', '{}', 'not json', { tool_name: 'Bash', tool_input: { command: 'ls' } }, { tool_name: 'Edit' }]) {
      assert.equal(hook(root, 'post-edit.mjs', payload).status, 0, JSON.stringify(payload));
    }
  });

  it('resolves a relative path against the payload cwd', () => {
    const file = write(root, 'backend-subtracker/src/broken.ts', `// ${MARKER}\n`);
    try {
      const run = hook(root, 'post-edit.mjs', edit('backend-subtracker/src/broken.ts', { cwd: root }));
      assert.equal(run.status, 2);
    } finally {
      rmSync(file);
    }
  });

  it('skips a file of another repository', () => {
    const other = makeRepo();
    const file = write(other, 'backend-subtracker/src/broken.ts', `// ${MARKER}\n`);
    assert.equal(hook(root, 'post-edit.mjs', edit(file)).status, 0);
  });

  it('never passes when a tool is missing: the user sees it (exit 1)', () => {
    const bare = makeRepo();
    rmSync(path.join(bare, 'backend-subtracker', 'node_modules', 'oxlint'), { recursive: true });
    const run = hook(bare, 'post-edit.mjs', edit(path.join(bare, 'backend-subtracker', 'src', 'ok.ts')));
    assert.equal(run.status, 1);
    assert.match(run.stderr, /skipped \(tool not installed, run npm ci\): backend oxlint --type-check/);
  });
});

describe('stop.mjs', () => {
  it('does nothing when nothing changed', () => {
    const root = makeRepo();
    const first = hook(root, 'stop.mjs', stop(root));
    assert.equal(first.status, 0);
    assert.equal(first.stdout, '');
    const again = hook(root, 'stop.mjs', stop(root));
    assert.equal(again.status, 0);
    assert.equal(again.stdout, '');
  });

  it('blocks once on a file changed outside Edit/Write (Bash), then lets the agent finish', () => {
    const root = makeRepo();
    write(root, 'backend-subtracker/src/ok.ts', `export const ok = 1; // ${MARKER}\n`);

    const blocked = hook(root, 'stop.mjs', stop(root));
    assert.equal(blocked.status, 0);
    const out = decision(blocked.stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /backend: oxlint --type-check failed/);
    assert.match(out.reason, /src\/ok\.ts: HOOK_BROKEN found/);

    const retry = hook(root, 'stop.mjs', stop(root, { stop_hook_active: true }));
    assert.equal(retry.status, 0);
    const told = decision(retry.stdout);
    assert.equal(told.decision, undefined, 'no second block');
    assert.match(told.systemMessage, /checks still red: backend oxlint --type-check/);

    write(root, 'backend-subtracker/src/ok.ts', 'export const ok = 2;\n');
    const fixed = hook(root, 'stop.mjs', stop(root, { stop_hook_active: true }));
    assert.equal(fixed.status, 0);
    assert.equal(fixed.stdout, '');
  });

  it('does not block at all when the first red result comes with stop_hook_active', () => {
    const root = makeRepo();
    write(root, 'frontend-subtracker/src/app.ts', `// ${MARKER}\n`);
    const run = hook(root, 'stop.mjs', stop(root, { stop_hook_active: true }));
    assert.equal(run.status, 0);
    const out = decision(run.stdout);
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /frontend tsc \(specs\)/);
  });

  it('re-checks an app after a config change, not only after a change in src/', () => {
    const root = makeRepo();
    assert.equal(hook(root, 'stop.mjs', stop(root)).stdout, '');
    write(root, 'backend-subtracker/package.json', `{ "x": "${MARKER}" }\n`);
    const out = decision(hook(root, 'stop.mjs', stop(root)).stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /package\.json: HOOK_BROKEN found/);
  });

  it('never passes when a tool is missing: the agent is told', () => {
    const root = makeRepo();
    rmSync(path.join(root, 'backend-subtracker', 'node_modules', 'vitest'), { recursive: true });
    write(root, 'backend-subtracker/src/ok.ts', 'export const ok = 3;\n');
    const out = decision(hook(root, 'stop.mjs', stop(root)).stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /backend: vitest run failed\ntool not installed \(run npm ci\)/);
  });

  it('passes on an empty or broken payload', () => {
    const root = makeRepo();
    for (const payload of ['', '{}', 'not json']) {
      assert.equal(hook(root, 'stop.mjs', payload).status, 0, JSON.stringify(payload));
    }
  });
});

describe('worktrees', () => {
  function withWorktree({ stubs = true } = {}) {
    const root = makeRepo();
    const wt = path.join(tempDir('agent-hooks-wt-'), 'wt');
    git(root, 'worktree', 'add', '-q', wt);
    const worktree = realpathSync.native(wt);
    if (stubs) installStubs(worktree);
    return { root, worktree };
  }

  it('post-edit checks the worktree of the edited file, not the main checkout', () => {
    const { root, worktree } = withWorktree();
    const file = write(worktree, 'backend-subtracker/src/broken.ts', `// ${MARKER}\n`);
    const run = hook(root, 'post-edit.mjs', edit(file, { session_id: 's1', cwd: root }));
    assert.equal(run.status, 2);
    assert.ok(run.stderr.includes(`backend (${worktree})`), run.stderr);
    // The main checkout stays green.
    assert.equal(hook(root, 'post-edit.mjs', edit(path.join(root, 'backend-subtracker', 'src', 'ok.ts'))).status, 0);
  });

  it('Stop sweeps a worktree edited in this session even though cwd is the main checkout', () => {
    const { root, worktree } = withWorktree();
    const file = write(worktree, 'backend-subtracker/src/ok.ts', 'export const ok = 5;\n');
    assert.equal(hook(root, 'post-edit.mjs', edit(file, { session_id: 's2', cwd: root })).status, 0);
    assert.equal(hook(root, 'stop.mjs', stop(root, { session_id: 's2' })).stdout, '');

    // Later in the session the worktree file is broken through Bash: no post-edit, only Stop.
    hook(root, 'post-edit.mjs', edit(file, { session_id: 's3', cwd: root }));
    write(worktree, 'backend-subtracker/src/ok.ts', `// ${MARKER}\n`);
    const out = decision(hook(root, 'stop.mjs', stop(root, { session_id: 's3' })).stdout);
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.includes(`backend (${worktree})`), out.reason);
  });

  it('Stop sweeps the worktree named by the payload cwd (after EnterWorktree)', () => {
    const { root, worktree } = withWorktree();
    write(worktree, 'frontend-subtracker/src/app.ts', `// ${MARKER}\n`);
    const out = decision(hook(root, 'stop.mjs', stop(worktree)).stdout);
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.includes(`frontend (${worktree})`), out.reason);
  });

  it('a worktree without node_modules is reported, not passed', () => {
    const { root, worktree } = withWorktree({ stubs: false });
    const file = write(worktree, 'backend-subtracker/src/ok.ts', 'export const ok = 6;\n');
    const run = hook(root, 'post-edit.mjs', edit(file));
    assert.equal(run.status, 1);
    assert.ok(run.stderr.includes(`skipped (tool not installed, run npm ci): backend (${worktree})`), run.stderr);
  });
});
