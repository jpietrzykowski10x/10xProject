// Run: node --test .claude/hooks/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  acquireLock,
  classify,
  editedFiles,
  fingerprint,
  groupByApp,
  hooksDisabled,
  nodeProblem,
  tail,
} from './agent-loop.mjs';

const WIN = 'C:\\Repositories\\10xDevs\\10xProject';
const POSIX = '/home/dev/10xProject';

describe('classify', () => {
  const cases = [
    // Checked files
    [`${WIN}\\backend-subtracker\\src\\subscriptions\\subscription-order.ts`, { app: 'backend', kind: 'ts' }],
    [`${WIN}\\backend-subtracker\\test\\subscriptions\\subscriptions.e2e-spec.ts`, { app: 'backend', kind: 'ts' }],
    [`${WIN}\\frontend-subtracker\\src\\app\\pages\\register\\register.html`, { app: 'frontend', kind: 'html' }],
    [`${WIN}\\frontend-subtracker\\src\\app\\app.routes.ts`, { app: 'frontend', kind: 'ts' }],
    // Drive letter in another case than the project dir
    [`c:\\Repositories\\10xDevs\\10xProject\\backend-subtracker\\src\\main.ts`, { app: 'backend', kind: 'ts' }],
    // Forward slashes on Windows
    [`C:/Repositories/10xDevs/10xProject/backend-subtracker/src/main.ts`, { app: 'backend', kind: 'ts' }],
    // Exclusions
    [`${WIN}\\context\\foundation\\test-plan.md`, null],
    [`${WIN}\\context\\changes\\agent-loop-hooks\\notes.ts`, null],
    [`${WIN}\\backend-subtracker\\README.md`, null],
    [`${WIN}\\backend-subtracker\\.env`, null],
    [`${WIN}\\backend-subtracker\\.env.mydevil`, null],
    [`${WIN}\\backend-subtracker\\src\\.env`, null],
    [`${WIN}\\backend-subtracker\\scripts\\prepare-mydevil.mjs`, null],
    [`${WIN}\\backend-subtracker\\vitest.config.ts`, null],
    [`${WIN}\\backend-subtracker\\src\\subscriptions\\notes.md`, null],
    [`${WIN}\\backend-subtracker\\node_modules\\vitest\\index.ts`, null],
    [`${WIN}\\backend-subtracker\\src\\node_modules\\x.ts`, null],
    [`${WIN}\\frontend-subtracker\\e2e\\guards.e2e-spec.ts`, null],
    [`${WIN}\\frontend-subtracker\\scripts\\test-time-zones.mjs`, null],
    [`${WIN}\\frontend-subtracker\\src\\styles\\_theme.scss`, null],
    [`${WIN}\\frontend-subtracker\\src\\app\\pages\\register\\register.scss`, null],
    [`${WIN}\\frontend-subtracker\\src\\index.html.bak`, null],
    [`${WIN}\\frontend-subtracker\\angular.json`, null],
    [`${WIN}\\.claude\\settings.json`, null],
    [`${WIN}\\.claude\\hooks\\post-edit.mjs`, null],
    [`${WIN}`, null],
    [`C:\\Repositories\\other\\backend-subtracker\\src\\main.ts`, null],
    [`D:\\backend-subtracker\\src\\main.ts`, null],
    ['', null],
  ];
  for (const [file, expected] of cases) {
    it(`${file || '(empty)'} -> ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(classify(file, WIN), expected);
    });
  }

  it('works with POSIX paths', () => {
    assert.deepEqual(classify(`${POSIX}/backend-subtracker/src/main.ts`, POSIX), { app: 'backend', kind: 'ts' });
    assert.deepEqual(classify(`${POSIX}/frontend-subtracker/src/app/app.html`, POSIX), { app: 'frontend', kind: 'html' });
    assert.equal(classify(`${POSIX}/context/foundation/prd.md`, POSIX), null);
    assert.equal(classify(`/home/dev/backend-subtracker/src/main.ts`, POSIX), null);
  });

  it('does not match directory names in a different case', () => {
    assert.equal(classify(`${WIN}\\Backend-Subtracker\\src\\main.ts`, WIN), null);
  });
});

describe('groupByApp', () => {
  it('splits files per app, skips frontend specs and non-code files', () => {
    const files = [
      `${WIN}\\backend-subtracker\\src\\subscriptions\\subscription-order.ts`,
      `${WIN}\\backend-subtracker\\src\\subscriptions\\subscription-order.spec.ts`,
      `${WIN}\\frontend-subtracker\\src\\app\\pages\\register\\register.html`,
      `${WIN}\\frontend-subtracker\\src\\app\\pages\\register\\register.spec.ts`,
      `${WIN}\\frontend-subtracker\\src\\app\\pages\\register\\register.scss`,
      `${WIN}\\context\\foundation\\test-plan.md`,
    ];
    assert.deepEqual(groupByApp(files, WIN), {
      backend: [files[0], files[1]],
      frontend: [files[2]],
    });
  });

  it('returns empty lists when only a frontend spec was edited', () => {
    assert.deepEqual(groupByApp([`${WIN}\\frontend-subtracker\\src\\app\\app.spec.ts`], WIN), {
      backend: [],
      frontend: [],
    });
  });
});

describe('editedFiles', () => {
  it('reads PostToolBatch tool_calls, only Edit and Write, without duplicates', () => {
    const input = {
      hook_event_name: 'PostToolBatch',
      tool_calls: [
        { tool_name: 'Edit', tool_input: { file_path: 'C:\\a.ts', old_string: 'x', new_string: 'y' } },
        { tool_name: 'Write', tool_input: { file_path: 'C:\\b.ts', content: '' } },
        { tool_name: 'Edit', tool_input: { file_path: 'C:\\a.ts' } },
        { tool_name: 'Read', tool_input: { file_path: 'C:\\c.ts' } },
        { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'C:\\d.ipynb' } },
        { tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ e.ts' } },
        { tool_name: 'Edit', tool_input: {} },
        null,
      ],
    };
    assert.deepEqual(editedFiles(input), ['C:\\a.ts', 'C:\\b.ts']);
  });

  it('reads a single PostToolUse call', () => {
    assert.deepEqual(
      editedFiles({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/y.ts' } }),
      ['/x/y.ts'],
    );
    assert.deepEqual(editedFiles({ tool_name: 'Read', tool_input: { file_path: '/x/y.ts' } }), []);
  });

  it('returns nothing for empty or unexpected input', () => {
    assert.deepEqual(editedFiles({}), []);
    assert.deepEqual(editedFiles(undefined), []);
    assert.deepEqual(editedFiles({ tool_calls: 'nope' }), []);
  });
});

describe('nodeProblem', () => {
  it('rejects Node 22.14.0', () => {
    assert.match(nodeProblem('v22.14.0'), /Node v22\.14\.0/);
  });
  it('rejects Node 24.14.9', () => {
    assert.notEqual(nodeProblem('v24.14.9'), null);
  });
  it('accepts Node 24.15.0 and 24.21.0', () => {
    assert.equal(nodeProblem('v24.15.0'), null);
    assert.equal(nodeProblem('v24.21.0'), null);
  });
  it('accepts a newer major', () => {
    assert.equal(nodeProblem('v26.0.0'), null);
  });
});

describe('hooksDisabled', () => {
  it('is true only for SUBTRACKER_AGENT_HOOKS=off', () => {
    assert.equal(hooksDisabled({ SUBTRACKER_AGENT_HOOKS: 'off' }), true);
    assert.equal(hooksDisabled({ SUBTRACKER_AGENT_HOOKS: 'on' }), false);
    assert.equal(hooksDisabled({}), false);
  });
});

describe('fingerprint', () => {
  it('changes with tracked edits, untracked content and commits, and only for the given dirs', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'agent-loop-git-'));
    const git = (...args) => {
      const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
        cwd: repo,
        encoding: 'utf8',
      });
      assert.equal(run.status, 0, run.stderr);
    };
    try {
      mkdirSync(path.join(repo, 'app', 'src'), { recursive: true });
      mkdirSync(path.join(repo, 'docs'));
      writeFileSync(path.join(repo, 'app', 'src', 'a.ts'), 'one');
      writeFileSync(path.join(repo, 'docs', 'x.md'), 'doc');
      git('init', '-q');
      git('add', '.');
      git('commit', '-q', '-m', 'init');
      const dirs = ['app/src'];

      const clean = fingerprint(repo, dirs);
      assert.match(clean, /^[0-9a-f]{64}$/);
      assert.equal(fingerprint(repo, dirs), clean, 'same state, same fingerprint');

      writeFileSync(path.join(repo, 'docs', 'x.md'), 'other doc');
      assert.equal(fingerprint(repo, dirs), clean, 'a file outside the dirs does not count');

      writeFileSync(path.join(repo, 'app', 'src', 'a.ts'), 'two');
      const edited = fingerprint(repo, dirs);
      assert.notEqual(edited, clean);
      writeFileSync(path.join(repo, 'app', 'src', 'a.ts'), 'three');
      assert.notEqual(fingerprint(repo, dirs), edited, 'another edit of an already changed file');

      writeFileSync(path.join(repo, 'app', 'src', 'new.ts'), 'x');
      const untracked = fingerprint(repo, dirs);
      writeFileSync(path.join(repo, 'app', 'src', 'new.ts'), 'y');
      assert.notEqual(fingerprint(repo, dirs), untracked, 'untracked file content counts');

      git('add', '.');
      git('commit', '-q', '-m', 'second');
      assert.notEqual(fingerprint(repo, dirs), clean, 'a new commit counts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('is null outside a git repository', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-loop-nogit-'));
    try {
      assert.equal(fingerprint(dir, ['src']), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('acquireLock', () => {
  it('takes, releases and replaces an orphaned lock', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-loop-'));
    try {
      const file = path.join(dir, 'backend.lock');
      const release = acquireLock(dir, 'backend', 60_000);
      assert.equal(existsSync(file), true);
      release();
      assert.equal(existsSync(file), false);

      writeFileSync(file, '0');
      const old = new Date(Date.now() - 120_000);
      utimesSync(file, old, old);
      const releaseAgain = acquireLock(dir, 'backend', 60_000);
      assert.equal(existsSync(file), true);
      releaseAgain();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('tail', () => {
  it('keeps the last lines and strips ANSI codes', () => {
    const output = 'one\r\n\x1b[31mtwo\x1b[39m\nthree\n\n';
    assert.equal(tail(output, 2), 'two\nthree');
    assert.equal(tail(output, 10), 'one\ntwo\nthree');
  });
  it('handles empty output', () => {
    assert.equal(tail(undefined, 5), '');
  });
});
