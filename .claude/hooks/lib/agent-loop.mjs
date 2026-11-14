// Shared rules for the agent-loop hooks (post-edit.mjs, stop.mjs). Both hooks import from here so
// the path filter, the Node check and the way tools are started cannot drift apart.
// Pure functions (everything except runTool and readHookInput) are covered by agent-loop.test.mjs:
// a wrong classify() would block the agent on edits of non-code files, which is the costliest bug.
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';

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
