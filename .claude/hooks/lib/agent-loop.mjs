// Shared rules for the agent-loop hooks (post-edit.mjs, stop.mjs). Both hooks import from here so
// the path filter, the Node check and the way tools are started cannot drift apart.
// Pure functions (everything except runTool and readHookInput) are covered by agent-loop.test.mjs:
// a wrong classify() would block the agent on edits of non-code files, which is the costliest bug.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';

/** Directories (relative to the project) whose state decides whether Stop checks an app. */
export const APP_DIRS = {
  backend: ['backend-subtracker/src', 'backend-subtracker/test'],
  frontend: ['frontend-subtracker/src'],
};

const MIN_NODE = [24, 15, 0];
const EDIT_TOOLS = new Set(['Edit', 'Write']);
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** `SUBTRACKER_AGENT_HOOKS=off` (shell or `env` in .claude/settings.local.json) turns both hooks off. */
export function hooksDisabled(env) {
  return env.SUBTRACKER_AGENT_HOOKS === 'off';
}

/**
 * `null` when the Node running the hook can run the apps' tools, otherwise a message for the user.
 * The hook starts with the first `node` on PATH and the tools inherit it; Angular CLI 22 refuses
 * anything older than 24.15, and a red check caused by the wrong Node would mislead the agent.
 */
export function nodeProblem(version) {
  const parts = String(version).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < MIN_NODE.length; i++) {
    const part = parts[i] ?? 0;
    if (Number.isNaN(part)) break;
    if (part > MIN_NODE[i]) return null;
    if (part < MIN_NODE[i]) {
      return `[agent-loop] hooks skipped: Node ${version}, required ${MIN_NODE.join('.')}+ (start the session from a shell with fnm)`;
    }
  }
  return null;
}

function pathFlavour(...paths) {
  return paths.some((p) => /^[a-zA-Z]:/.test(p) || p.includes('\\')) ? path.win32 : path.posix;
}

/**
 * Which app an edited file belongs to, or `null` when the hook must not check anything.
 * Only `backend-subtracker/{src,test}/**\/*.ts` and `frontend-subtracker/src/**\/*.{ts,html}` count;
 * everything else (context/, *.md, .env*, e2e/, *.scss, node_modules/, paths outside the project)
 * is `null`.
 */
export function classify(absPath, projectDir) {
  if (typeof absPath !== 'string' || absPath === '') return null;
  const p = pathFlavour(absPath, projectDir);
  const rel = p.relative(projectDir, absPath);
  if (rel === '' || p.isAbsolute(rel)) return null;
  const parts = rel.split(p.sep);
  if (parts[0] === '..' || parts.includes('node_modules')) return null;
  const normalized = parts.join('/');

  if (/^backend-subtracker\/(src|test)\/.+\.ts$/.test(normalized)) {
    return { app: 'backend', kind: 'ts' };
  }
  const front = /^frontend-subtracker\/src\/.+\.(ts|html)$/.exec(normalized);
  if (front) {
    return { app: 'frontend', kind: front[1] };
  }
  return null;
}

/**
 * Edited files the post-edit check covers, per app. Frontend specs are left out: they are outside
 * tsconfig.app.json, so ngc would not see them (Stop checks them).
 */
export function groupByApp(files, projectDir) {
  const byApp = { backend: [], frontend: [] };
  for (const file of files) {
    const kind = classify(file, projectDir);
    if (!kind) continue;
    if (kind.app === 'frontend' && /\.spec\.ts$/.test(file)) continue;
    byApp[kind.app].push(file);
  }
  return byApp;
}

/**
 * Absolute paths of files written by Edit/Write, from either input shape:
 * `PostToolBatch` (`tool_calls[]`) or `PostToolUse` (one `tool_name` + `tool_input`).
 */
export function editedFiles(hookInput) {
  const calls = Array.isArray(hookInput?.tool_calls) ? hookInput.tool_calls : [hookInput ?? {}];
  const files = [];
  for (const call of calls) {
    const file = call?.tool_input?.file_path;
    if (EDIT_TOOLS.has(call?.tool_name) && typeof file === 'string' && !files.includes(file)) {
      files.push(file);
    }
  }
  return files;
}

/** Last `lines` lines of a tool's output, without ANSI colour codes. */
export function tail(output, lines) {
  const all = String(output ?? '')
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n');
  return all.slice(-lines).join('\n');
}

/**
 * Runs a tool's Node entry point with the Node running the hook (no npx, no .cmd, no shell), as
 * frontend-subtracker/scripts/test-time-zones.mjs does. The environment is passed on, never printed.
 */
export function runTool(appDir, scriptPath, args, extraEnv = {}) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: appDir,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...extraEnv },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const output = run.error ? String(run.error.message) : `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return { ok: !run.error && run.status === 0, output, ms: Date.now() - started };
}

/** Async variant of runTool, so Stop can check both apps at the same time. */
export function runToolAsync(appDir, scriptPath, args, extraEnv = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: appDir,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...extraEnv },
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => resolve({ ok: false, output: String(error.message), ms: Date.now() - started }));
    child.on('close', (code) => resolve({ ok: code === 0, output, ms: Date.now() - started }));
  });
}

/**
 * Hash of the git state of `dirs` (relative to `projectDir`): the HEAD commit, `git status` of those
 * directories and the content of every changed or untracked file in them. It changes with any edit,
 * also one made through Bash, so Stop checks an app only when something in it changed since the
 * last check. `null` when git cannot be asked (Stop then checks and does not remember).
 */
export function fingerprint(projectDir, dirs) {
  const git = (args) => {
    const run = spawnSync('git', args, { cwd: projectDir, encoding: 'buffer', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw new Error(`git ${args[0]} failed`);
    return run.stdout;
  };
  try {
    const hash = createHash('sha256');
    hash.update(git(['rev-parse', 'HEAD']));
    const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...dirs]);
    hash.update(status);
    const entries = status.toString('utf8').split('\0');
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.length < 4) continue;
      // A rename or copy is followed by its source path, which is not a file to read.
      if (entry[0] === 'R' || entry[0] === 'C') i++;
      const file = entry.slice(3);
      hash.update(`\0${file}\0`);
      try {
        hash.update(readFileSync(path.join(projectDir, file)));
      } catch {
        hash.update('<missing>');
      }
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/**
 * Waits for and takes the lock `<stateDir>/<name>.lock`; returns a function that releases it.
 * PostToolUse runs once per edit and parallel edits run their hooks in parallel, so checks of the
 * same app go one after another instead of overlapping. A lock older than `staleMs` (the hook's
 * timeout) belongs to a hook that was killed and is removed.
 */
export function acquireLock(stateDir, name, staleMs, pollMs = 200) {
  mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, `${name}.lock`);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    try {
      if (Date.now() - statSync(file).mtimeMs > staleMs) {
        rmSync(file, { force: true });
        continue;
      }
    } catch {
      continue; // released between the two calls
    }
    Atomics.wait(sleeper, 0, 0, pollMs);
  }
}

/** Hook input JSON from stdin; `{}` when stdin is empty or not JSON. */
export async function readHookInput() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
