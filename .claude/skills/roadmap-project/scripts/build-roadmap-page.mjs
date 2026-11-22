#!/usr/bin/env node
// Builds the roadmap progress page (one self-contained HTML file) from context/foundation/roadmap.md
// and, when present, the §3 Phased Rollout table of context/foundation/test-plan.md. Prints a JSON
// summary of the percentages to stdout. No dependencies; run from the repository root:
//
//   node .claude/skills/roadmap-project/scripts/build-roadmap-page.mjs --out <file.html>
//        [--next <ID>] [--title "<page title>"] [--date YYYY-MM-DD] [--root <repo dir>]
//        [--current-only] [--refresh-history]
//
// Closed milestones stay on the page: every entry of "## Milestone History" is drawn below the
// current milestone as a finished band. Closing a milestone removes its item blocks from
// roadmap.md, so their titles, prerequisites and streams come from the last git version of
// roadmap.md in which that milestone was the current one; without git, from "## Done" (no edges).
// --current-only leaves the closed milestones out (only when the user asks for it).
// Once read from git, a closed milestone is saved in ../data/milestones/<M-N>.json and read from
// there afterwards; --refresh-history reads git again and rewrites those files.
//
// Exit codes: 0 ok, 2 no roadmap, 1 any other error.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true';
    args[key.slice(2)] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? process.cwd());
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roadmapPath = join(root, 'context/foundation/roadmap.md');
const testPlanPath = join(root, 'context/foundation/test-plan.md');

if (!existsSync(roadmapPath)) {
  process.stderr.write(`No roadmap at ${roadmapPath}. Run /10x-roadmap first.\n`);
  process.exit(2);
}
if (!args.out) {
  process.stderr.write('Missing --out <file.html>.\n');
  process.exit(1);
}

const today = args.date ?? new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time
const roadmap = readFileSync(roadmapPath, 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- parsing

const ID_RE = /\b([FS]-\d{2,})\b/g;
const idsIn = (text) => [...new Set([...(text ?? '').matchAll(ID_RE)].map((m) => m[1]))];

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const data = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (kv) data[kv[1]] = kv[2].trim();
    }
  }
  return data;
}

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

function tableRows(text) {
  const rows = text
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    );
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  return rows
    .slice(2)
    .map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}

const field = (block, name) => {
  const m = new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'm').exec(block);
  return m ? m[1].trim() : '';
};

function parseItems(text) {
  const out = [];
  const heads = [...text.matchAll(/^### ([FS]-\d{2,}): (.+)$/gm)];
  heads.forEach((m, i) => {
    const from = m.index;
    const nextHead = heads[i + 1]?.index ?? text.length;
    // The block ends at the next item heading or the next "## " section, whichever comes first;
    // the search starts after the heading line, which itself contains "## ".
    const bodyStart = from + m[0].length;
    const nextSection = text.slice(bodyStart).search(/^## /m);
    const to = nextSection < 0 ? nextHead : Math.min(nextHead, bodyStart + nextSection);
    const block = text.slice(from, to);
    out.push({
      id: m[1],
      title: m[2].trim(),
      kind: m[1].startsWith('F') ? 'foundation' : 'slice',
      outcome: field(block, 'Outcome').replace(/^\(foundation\)\s*/, ''),
      changeId: field(block, 'Change ID'),
      refs: [...new Set(field(block, 'PRD refs').match(/FR-\d+/g) ?? [])],
      prereqs: idsIn(field(block, 'Prerequisites')),
      status: (field(block, 'Status') || 'proposed').toLowerCase(),
    });
  });
  return out;
}

// "## Done": "- **S-08: outcome…** — Archived 2026-11-18 → …".
function parseDone(text) {
  const out = new Map();
  for (const line of section(text, 'Done').split('\n')) {
    const m = /^- \*\*([FS]-\d{2,}):\s*([\s\S]*?)\*\*[\s\S]*?Archived (\d{4}-\d{2}-\d{2})/.exec(line);
    if (m) out.set(m[1], { outcome: m[2].replace(/^\(foundation\)\s*/, '').trim(), archived: m[3] });
  }
  return out;
}

// One milestone as the roadmap describes it while it is the current one.
function parseMilestone(text) {
  const milestoneText = section(text, 'Milestone');
  const head = /\*\*([^*]+?)\*\*\s*—\s*Status:\s*(\w+)/.exec(milestoneText);
  const full = head ? head[1].trim() : '';
  const list = parseItems(text);
  const ids = new Set(list.map((it) => it.id));
  for (const it of list) it.prereqs = it.prereqs.filter((p) => ids.has(p) && p !== it.id);
  const streamList = tableRows(section(text, 'Streams'))
    .map((row) => ({
      name: row.stream ?? '',
      theme: row.theme ?? '',
      ids: idsIn(row.chain ?? '').filter((id) => ids.has(id)),
      chain: (row.chain ?? '').replace(/`/g, ''),
    }))
    .filter((s) => s.name && s.ids.length > 0);
  for (const s of streamList) for (const it of list) if (s.ids.includes(it.id)) it.stream ??= s.name;
  const anchors = field(milestoneText, 'Scope anchors').split(/Nice-to-have/i)[0];
  return {
    id: /^(M-\d+)/.exec(full)?.[1] ?? '',
    name: full.replace(/^M-\d+:\s*/, ''),
    full,
    status: head ? head[2].toLowerCase() : '',
    items: list,
    streams: streamList,
    mustHave: [...new Set(anchors.match(/FR-\d+/g) ?? [])],
    northStar: idsIn(section(text, 'North star'))[0] ?? null,
  };
}

const meta = frontmatter(roadmap);
const current = parseMilestone(roadmap);
const items = current.items;
if (items.length === 0) {
  process.stderr.write('The roadmap has no "### F-NN:" / "### S-NN:" items.\n');
  process.exit(1);
}
const doneLog = parseDone(roadmap);
for (const it of items) if (doneLog.has(it.id)) it.archived = doneLog.get(it.id).archived;
const milestone = current.full;
const mustHave = current.mustHave;
const northStar = current.northStar;
const streams = current.streams;

// ---------------------------------------------------------------- closed milestones

// "## Milestone History": "- **M-1: Name** (`slug`) — closed 2026-11-22. Summary…".
const history = section(roadmap, 'Milestone History')
  .split('\n')
  .map((line) =>
    /^- \*\*(M-\d+):\s*(.+?)\*\*(?:\s*\(`([^`]+)`\))?[\s\S]*?closed (\d{4}-\d{2}-\d{2})\.?\s*(.*)$/.exec(line),
  )
  .filter(Boolean)
  .map((m) => ({ id: m[1], name: m[2].trim(), slug: m[3] ?? '', closed: m[4], summary: m[5].trim() }))
  .filter((h) => h.id !== current.id);

// Git versions of roadmap.md, newest first, read lazily.
const roadmapRel = 'context/foundation/roadmap.md';
let gitCommits = null;
const gitShowCache = new Map();
function git(argv) {
  try {
    return execFileSync('git', argv, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}
// The newest git version in which `milestoneId` was the current milestone = its final state.
function snapshotOf(milestoneId) {
  gitCommits ??= (git(['log', '--format=%H', '--', roadmapRel]) ?? '').split('\n').filter(Boolean);
  for (const hash of gitCommits) {
    if (!gitShowCache.has(hash)) {
      gitShowCache.set(hash, git(['show', `${hash}:${roadmapRel}`])?.replace(/\r\n/g, '\n') ?? null);
    }
    const text = gitShowCache.get(hash);
    if (!text) continue;
    const parsed = parseMilestone(text);
    if (parsed.id === milestoneId && parsed.items.length > 0) {
      return { ...parsed, doneLog: parseDone(text), commit: hash.slice(0, 7) };
    }
  }
  return null;
}

// A closed milestone does not change any more, so once read from git it is saved as
// data/milestones/<M-N>.json next to the skill and read from there on every later run.
// --refresh-history ignores the saved files and reads git again (and rewrites them).
const dataDir = join(skillDir, 'data', 'milestones');
const dataRel = (id) => `.claude/skills/roadmap-project/data/milestones/${id}.json`;
function readSaved(id) {
  const file = join(dataDir, `${id}.json`);
  if (args['refresh-history'] === 'true' || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function save(record) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, `${record.id}.json`), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

// Final state of a closed milestone from git, with archive dates and "done" from "## Done".
function fromGit(h) {
  const snap = snapshotOf(h.id);
  if (!snap) return null;
  for (const it of snap.items) {
    const d = doneLog.get(it.id) ?? snap.doneLog.get(it.id);
    if (d) {
      it.archived = d.archived;
      it.status = 'done';
    }
  }
  return {
    id: h.id,
    name: h.name,
    slug: h.slug,
    closed: h.closed,
    summary: h.summary,
    commit: snap.commit,
    mustHave: snap.mustHave,
    northStar: snap.northStar,
    streams: snap.streams,
    items: snap.items.map(({ id, title, kind, outcome, changeId, refs, prereqs, status, archived, stream }) => ({
      id, title, kind, outcome, changeId, refs, prereqs, status, archived, stream,
    })),
  };
}

const seen = new Set(items.map((it) => it.id));
const closed = [];
const savedNow = [];
if (args['current-only'] !== 'true') {
  for (const h of history) {
    let record = readSaved(h.id);
    let source = record ? `z pliku ${dataRel(h.id)}` : '';
    if (!record) {
      record = fromGit(h);
      if (record) {
        save(record);
        savedNow.push(dataRel(h.id));
        source = `z git ${record.commit}, zapisane w ${dataRel(h.id)}`;
      }
    }
    if (!record) {
      closed.push({ ...h, items: [], streams: [], mustHave: [], northStar: null, source: 'z ## Done, bez zależności' });
      continue;
    }
    const own = record.items.filter((it) => !seen.has(it.id));
    for (const it of own) seen.add(it.id);
    const ownIds = new Set(own.map((it) => it.id));
    for (const it of own) it.prereqs = it.prereqs.filter((p) => ownIds.has(p));
    closed.push({
      ...h,
      items: own,
      streams: record.streams
        .map((s) => ({ ...s, ids: s.ids.filter((id) => ownIds.has(id)) }))
        .filter((s) => s.ids.length > 0),
      mustHave: record.mustHave,
      northStar: record.northStar,
      source,
    });
  }
  // Neither a saved file nor git: whatever "## Done" lists and no band has drawn yet, no edges.
  const leftovers = [...doneLog.entries()]
    .filter(([id]) => !seen.has(id))
    .map(([id, d]) => ({
      id,
      title: d.outcome.length > 60 ? `${d.outcome.slice(0, 57).replace(/\s+\S*$/, '')}…` : d.outcome,
      kind: id.startsWith('F') ? 'foundation' : 'slice',
      outcome: d.outcome,
      refs: [],
      prereqs: [],
      status: 'done',
      archived: d.archived,
    }));
  if (leftovers.length > 0) {
    const target = closed.find((c) => c.items.length === 0);
    if (target) target.items = leftovers;
    else {
      closed.push({
        id: '',
        name: 'Wcześniej zrobione',
        slug: '',
        closed: '',
        summary: '',
        items: leftovers,
        streams: [],
        mustHave: [],
        northStar: null,
        source: 'z ## Done, bez zależności',
      });
    }
  }
}
const closedBands = closed.filter((c) => c.items.length > 0);
const byId = new Map([...items, ...closedBands.flatMap((c) => c.items)].map((it) => [it.id, it]));

// Test plan §3: rows with Status "complete".
let testPlan = null;
if (existsSync(testPlanPath)) {
  const tp = readFileSync(testPlanPath, 'utf8').replace(/\r\n/g, '\n');
  const lines = tp.split('\n');
  const start = lines.findIndex((l) => /^## 3\. /.test(l));
  if (start >= 0) {
    const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    const rows = tableRows(lines.slice(start + 1, end < 0 ? undefined : end).join('\n'));
    if (rows.length > 0) {
      testPlan = {
        done: rows.filter((r) => (r.status ?? '').toLowerCase() === 'complete').length,
        total: rows.length,
      };
    }
  }
}

// ---------------------------------------------------------------- numbers

const isDone = (it) => it.status === 'done';
const pct = (a, b) => (b === 0 ? 0 : (a * 100) / b);
const done = items.filter(isDone);
const remaining = items.filter((it) => !isDone(it));

const doneFr = new Set(done.flatMap((it) => it.refs));
const frMissing = mustHave.filter((fr) => !doneFr.has(fr));
const frOwners = (fr) => remaining.filter((it) => it.refs.includes(fr)).map((it) => it.id);
const nonFrRemaining = remaining.filter((it) => it.refs.length === 0).map((it) => it.id);

// Next: --next, else the item in progress, else the first unblocked item in roadmap order.
const unblocked = (it) => it.prereqs.every((p) => isDone(byId.get(p)));
const next =
  (args.next && byId.has(args.next) && !isDone(byId.get(args.next)) && args.next) ||
  remaining.find((it) => it.status === 'in-progress')?.id ||
  remaining.find(unblocked)?.id ||
  null;

// Remaining order: next first, then roadmap order.
remaining.sort((a, b) => (a.id === next ? -1 : b.id === next ? 1 : 0));

// ---------------------------------------------------------------- graph layout

const W = 184;
const H = 84;
const COL_GAP = 40;
const ROW = H + 18;
const BAND_HEAD = 40; // milestone label above each band
const BAND_GAP = 36; // space between bands (a rule sits in the middle)
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Lays out one milestone's items left to right (depth = column); y starts at 0. Prerequisites
// only point inside the same list. Returns the omitted transitive edges and the band size.
function layout(list) {
  const local = new Map(list.map((it) => [it.id, it]));
  const prereqsOf = (id) => local.get(id).prereqs.filter((p) => local.has(p));

  // Transitive reduction: drop u→v when v is reachable from u another way.
  function reachable(from, target) {
    const stack = prereqsOf(from).filter((p) => p !== target);
    const visited = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === target) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      stack.push(...prereqsOf(cur));
    }
    return false;
  }
  const omittedHere = [];
  for (const it of list) {
    const own = prereqsOf(it.id);
    it.parents = own.filter((p) => !reachable(it.id, p));
    for (const p of own) if (!it.parents.includes(p)) omittedHere.push(`${p} → ${it.id}`);
  }
  for (const it of list) it.children = list.filter((c) => c.parents.includes(it.id)).map((c) => c.id);

  // Depth = longest path from a root.
  const depthMemo = new Map();
  function depth(id, trail = new Set()) {
    if (depthMemo.has(id)) return depthMemo.get(id);
    if (trail.has(id)) return 0; // cycle guard
    trail.add(id);
    const it = local.get(id);
    const d = it.parents.length ? 1 + Math.max(...it.parents.map((p) => depth(p, trail))) : 0;
    trail.delete(id);
    depthMemo.set(id, d);
    return d;
  }
  for (const it of list) it.depth = depth(it.id);
  const maxDepth = Math.max(...list.map((it) => it.depth));
  const columns = Array.from({ length: maxDepth + 1 }, (_, d) => list.filter((it) => it.depth === d));
  const order = new Map(list.map((it, i) => [it.id, i]));

  function place(column, desired) {
    const sorted = [...column].sort(
      (a, b) => desired.get(a.id) - desired.get(b.id) || order.get(a.id) - order.get(b.id),
    );
    let prev = -Infinity;
    const ys = sorted.map((it) => (prev = Math.max(desired.get(it.id), prev + ROW)));
    const shift = mean(sorted.map((it) => desired.get(it.id))) - mean(ys);
    sorted.forEach((it, i) => (it.y = ys[i] + shift));
  }
  for (const column of columns) {
    const desired = new Map(
      column.map((it) => [it.id, it.parents.length ? mean(it.parents.map((p) => local.get(p).y)) : 0]),
    );
    place(column, desired);
  }
  for (let d = columns.length - 2; d >= 0; d -= 1) {
    const desired = new Map(
      columns[d].map((it) => [
        it.id,
        it.children.length ? mean(it.children.map((c) => local.get(c).y)) : it.y,
      ]),
    );
    place(columns[d], desired);
  }
  const minY = Math.min(...list.map((it) => it.y));
  for (const it of list) {
    it.y = Math.round(it.y - minY);
    it.x = 20 + it.depth * (W + COL_GAP);
  }
  return {
    omitted: omittedHere,
    width: (maxDepth + 1) * (W + COL_GAP) - COL_GAP,
    height: Math.max(...list.map((it) => it.y)) + H,
  };
}

// Bands top to bottom: the current milestone, then the closed ones (newest first, as listed).
const bands = [
  { kind: 'current', id: current.id, name: current.name, items, northStar },
  ...closedBands.map((c) => ({ kind: 'closed', id: c.id, name: c.name, closed: c.closed, items: c.items, northStar: c.northStar })),
];
let cursor = 20;
for (const band of bands) {
  const box = layout(band.items);
  band.omitted = box.omitted;
  band.top = cursor;
  for (const it of band.items) it.y += cursor + BAND_HEAD;
  band.width = box.width;
  cursor += BAND_HEAD + box.height + BAND_GAP;
}
const omitted = bands.flatMap((b) => b.omitted);
const svgW = 20 + Math.max(...bands.map((b) => b.width)) + 20;
const svgH = cursor - BAND_GAP + 20;

// ---------------------------------------------------------------- text helpers

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function wrap(text, max, lines) {
  const words = text.split(/\s+/);
  const out = [''];
  for (const w of words) {
    const cur = out[out.length - 1];
    if (!cur) out[out.length - 1] = w;
    else if ((cur + ' ' + w).length <= max) out[out.length - 1] = cur + ' ' + w;
    else out.push(w);
  }
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = kept[lines - 1].replace(/\s*\S*$/, '') + '…';
    return kept;
  }
  return out;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const last = n % 10;
  const lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}

const STATUS_PL = {
  done: 'zrobione',
  'in-progress': 'w toku',
  ready: 'gotowe do startu',
  planning: 'planowane',
  proposed: 'proponowane',
  blocked: 'zablokowane',
};
const statusPl = (s) => STATUS_PL[s] ?? s;
const shortDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
const longDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// ---------------------------------------------------------------- SVG

function nodeSvg(it, band) {
  const cls = isDone(it) ? 'done' : it.status === 'in-progress' ? 'active' : 'todo';
  const nextCls = it.id === next ? ' next' : '';
  const label = `${it.id}${it.id === band.northStar ? ' ★' : ''}${it.stream ? ` · ${it.stream}` : ''}`;
  const name = wrap(it.title, 24, 2);
  const refs = it.refs.slice(0, 2).join(', ') + (it.refs.length > 2 ? '…' : '');
  const metaText = [isDone(it) ? shortDate(it.archived) || 'zrobione' : statusPl(it.status), refs]
    .filter(Boolean)
    .join(' · ');
  const nameY = name.length === 1 ? [46] : [40, 56];
  const badge = isDone(it)
    ? `<circle class="check" cx="${W - 14}" cy="16" r="5"/>`
    : nextCls
      ? `<rect class="pill" x="${W - 78}" y="8" width="66" height="17" rx="8.5"/><text class="pill-text" x="${W - 45}" y="20.5" text-anchor="middle">NASTĘPNE</text>`
      : cls === 'active'
        ? `<rect class="pill" x="${W - 66}" y="8" width="54" height="17" rx="8.5"/><text class="pill-text" x="${W - 39}" y="20.5" text-anchor="middle">W TOKU</text>`
        : '';
  return `<g class="node ${cls}${nextCls}" transform="translate(${it.x} ${it.y})">
  <title>${esc(`${it.id}: ${it.title} — ${statusPl(it.status)}`)}</title>
  <rect class="box" width="${W}" height="${H}" rx="4"/>
  <text class="id" x="12" y="20">${esc(label)}</text>${badge}
  ${name.map((l, i) => `<text class="name" x="12" y="${nameY[i]}">${esc(l)}</text>`).join('')}
  <text class="meta" x="12" y="74">${esc(metaText)}</text>
</g>`;
}

function edgeSvg(parent, child) {
  const x1 = parent.x + W;
  const y1 = parent.y + H / 2;
  const x2 = child.x - 2;
  const y2 = child.y + H / 2;
  const dx = Math.max(16, (x2 - x1) / 2);
  const done = isDone(child);
  const d =
    y1 === y2
      ? `M${x1} ${y1} L${x2} ${y2}`
      : `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  return `<path class="edge ${done ? 'done' : 'todo'}" marker-end="url(#${done ? 'ad' : 'at'})" d="${d}"/>`;
}

// Band heading: "M-2 · Name — w toku" for the current milestone, "… — zamknięty DD.MM.RRRR" below.
function bandLabel(band) {
  const doneHere = band.items.filter(isDone).length;
  const state =
    band.kind === 'current'
      ? `bieżący · ${doneHere} z ${band.items.length}`
      : `zamknięty${band.closed ? ` ${longDate(band.closed)}` : ''} · ${doneHere} z ${band.items.length}`;
  return { head: [band.id, band.name].filter(Boolean).join(' · '), state };
}
function bandSvg(band, index) {
  const { head, state } = bandLabel(band);
  const rule =
    index > 0
      ? `<line class="band-rule" x1="20" x2="${svgW - 20}" y1="${band.top - BAND_GAP / 2}" y2="${band.top - BAND_GAP / 2}"/>`
      : '';
  return `${rule}
          <text class="band-head ${band.kind}" x="20" y="${band.top + 16}">${esc(head)}<tspan class="band-state" dx="12">${esc(state)}</tspan></text>
          ${band.items.flatMap((it) => it.parents.map((p) => edgeSvg(byId.get(p), it))).join('\n          ')}
          ${band.items.map((it) => nodeSvg(it, band)).join('\n          ')}`;
}
const graphSvg = bands.map(bandSvg).join('\n          ');
const svgDesc =
  bands
    .map(
      (band) =>
        `${bandLabel(band).head} (${bandLabel(band).state}): ` +
        band.items
          .map((it) => `${it.id} (${statusPl(it.status)})${it.parents.length ? ` zależy od ${it.parents.join(', ')}` : ''}`)
          .join('; '),
    )
    .join('. ') + '.';

// ---------------------------------------------------------------- page

const project = meta.project || 'projektu';
const title = args.title || `Roadmapa ${project}`;
const milestoneId = /^(M-\d+)/.exec(milestone)?.[1] ?? '';
const milestoneName = milestone.replace(/^M-\d+:\s*/, '');

function meter(label, a, b, note) {
  const p = pct(a, b);
  return `<div class="meter">
  <div class="meter-head"><span class="meter-label">${esc(label)}</span><span class="meter-value num">${Math.round(p)}%</span></div>
  <div class="bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}" aria-valuetext="${a} z ${b} (${Math.round(p)}%)"><span style="width:${p.toFixed(1)}%"></span></div>
  <span class="meter-note num">${esc(note)}</span>
</div>`;
}

const doneF = done.filter((it) => it.kind === 'foundation').length;
const doneS = done.filter((it) => it.kind === 'slice').length;
const meters = [
  meter(
    'Pozycje roadmapy',
    done.length,
    items.length,
    `${done.length} z ${items.length} (${doneF} ${plural(doneF, 'fundament', 'fundamenty', 'fundamentów')}, ${doneS} ${plural(doneS, 'slice', "slice'y", "slice'ów")})`,
  ),
];
if (mustHave.length > 0) {
  const covered = mustHave.length - frMissing.length;
  const missingNote = frMissing.map((fr) => `${fr}${frOwners(fr).length ? ` (${frOwners(fr).join(', ')})` : ''}`);
  const extra = nonFrRemaining.length ? `; poza FR: ${nonFrRemaining.join(', ')}` : '';
  meters.push(
    meter(
      'Wymagania must-have (FR)',
      covered,
      mustHave.length,
      `${covered} z ${mustHave.length}${missingNote.length ? `; brakuje ${missingNote.join(', ')}` : ''}${extra}`,
    ),
  );
}
if (testPlan) {
  meters.push(meter('Etapy planu testów', testPlan.done, testPlan.total, `${testPlan.done} z ${testPlan.total}`));
}

const remainingNames = remaining.map(
  (it) => `${it.title} (${it.id}${it.id === next ? ', następne' : ''})`,
);
const lede =
  remaining.length === 0
    ? `Wszystkie ${items.length} pozycji są zrobione. Kamień milowy można zamknąć.`
    : `${done.length} z ${items.length} pozycji jest zrobionych. Zostało: ${remainingNames.join(', ')}.`;

const streamCards = streams
  .map((s) => {
    const d = s.ids.filter((id) => isDone(byId.get(id))).length;
    return `<div class="stream">
  <div class="stream-head"><span class="stream-title">${esc(s.name)} · ${esc(s.theme)}</span><span class="stream-count num">${d} z ${s.ids.length}</span></div>
  <div class="bar"><span style="width:${pct(d, s.ids.length).toFixed(1)}%"></span></div>
  <div class="stream-chain">${esc(s.chain)}</div>
</div>`;
  })
  .join('\n');

const remainingCards = remaining
  .map(
    (it) => `<div class="left-item${it.id === next ? ' next' : ''}">
  <span class="left-id">${esc(it.id)}</span>
  <span class="left-name">${esc(it.title)}${it.id === next ? ' <span class="tag">następne</span>' : ''} <span class="left-status">${esc(statusPl(it.status))}</span></span>
  <p class="left-body">${esc(it.outcome)}</p>
</div>`,
  )
  .join('\n');

const omittedNote = omitted.length
  ? ` Pominięte zależności przechodnie: ${omitted.join(', ')}.`
  : '';
const bandsNote = closedBands.length
  ? ` Pod bieżącym kamieniem milowym są zamknięte (${closedBands.map((c) => c.id || c.name).join(', ')}).`
  : '';

function closedNumbers(c) {
  const doneHere = c.items.filter(isDone);
  const frDone = new Set(doneHere.flatMap((it) => it.refs));
  return {
    done: doneHere.length,
    total: c.items.length,
    frCovered: c.mustHave.filter((fr) => frDone.has(fr)).length,
    frTotal: c.mustHave.length,
  };
}
const closedCards = closed
  .map((c) => {
    const n = closedNumbers(c);
    const facts = [
      `${n.done} z ${n.total} pozycji`,
      n.frTotal ? `${n.frCovered} z ${n.frTotal} FR must-have` : '',
      c.closed ? `zamknięty ${longDate(c.closed)}` : '',
    ].filter(Boolean);
    const streamLines = c.streams
      .map((s) => {
        const d = s.ids.filter((id) => isDone(byId.get(id))).length;
        return `<li><span class="stream-title">${esc(s.name)} · ${esc(s.theme)}</span> <span class="stream-count num">${d} z ${s.ids.length}</span><div class="stream-chain">${esc(s.chain)}</div></li>`;
      })
      .join('');
    return `<div class="closed-item">
  <div class="stream-head"><span class="stream-title">${esc([c.id, c.name].filter(Boolean).join(' · '))}</span><span class="closed-tag">zamknięty</span></div>
  <p class="closed-facts num">${esc(facts.join(' · '))}</p>
  ${c.summary ? `<p class="left-body closed-summary">${esc(c.summary)}</p>` : ''}
  ${streamLines ? `<ul class="closed-streams">${streamLines}</ul>` : ''}
</div>`;
  })
  .join('\n');

const html = `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
  /* Generated by .claude/skills/roadmap-project — do not edit by hand, re-run the skill.
     Layout: navy summary band, dependency graph left to right (depth = columns), streams, what is left. */
  :root {
    --page: #f3f5f7; --surface: #ffffff; --ink: #16202c; --ink-soft: #33404e; --muted: #4f5d6c;
    --line: #d5dce3; --navy: #14284b; --navy-line: #33486c; --on-navy: #ffffff; --on-navy-soft: #c5d1e2;
    --lime: #b8d435; --on-lime: #14284b; --track: #d5dce3; --node-done: #14284b; --node-done-ink: #ffffff;
    --node-done-soft: #c5d1e2; --node-todo: #ffffff; --node-todo-ink: #16202c; --node-todo-line: #767680;
    --edge: #8a97a6; --edge-done: #14284b;
    --font-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --page: #0d1626; --surface: #15223a; --ink: #e8edf4; --ink-soft: #c9d3e0; --muted: #9aa8ba;
      --line: #2b3b57; --navy: #0a1424; --navy-line: #2b3b57; --on-navy: #ffffff; --on-navy-soft: #b7c4d8;
      --track: #2b3b57; --node-done: #22385f; --node-todo: #15223a; --node-todo-ink: #e8edf4;
      --node-todo-line: #7d8aa0; --edge: #6b7a91; --edge-done: #9fb2d3; color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --page: #0d1626; --surface: #15223a; --ink: #e8edf4; --ink-soft: #c9d3e0; --muted: #9aa8ba;
    --line: #2b3b57; --navy: #0a1424; --navy-line: #2b3b57; --on-navy: #ffffff; --on-navy-soft: #b7c4d8;
    --track: #2b3b57; --node-done: #22385f; --node-todo: #15223a; --node-todo-ink: #e8edf4;
    --node-todo-line: #7d8aa0; --edge: #6b7a91; --edge-done: #9fb2d3; color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 var(--font-sans); }
  .wrap { max-width: 1240px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  .num { font-variant-numeric: tabular-nums; }
  .band { background: var(--navy); color: var(--on-navy); }
  .band .wrap { padding-block: 32px 36px; display: grid; gap: 28px; }
  .eyebrow { margin: 0; color: var(--on-navy-soft); font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; }
  h1 { margin: 4px 0 0; font-size: clamp(26px, 4vw, 34px); line-height: 1.15; font-weight: 700; text-wrap: balance; }
  .lede { margin: 8px 0 0; max-width: 70ch; color: var(--on-navy-soft); }
  .meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px 32px; }
  .meter { display: grid; gap: 6px; min-width: 0; }
  .meter-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .meter-label { font-weight: 600; }
  .meter-value { font-size: 28px; font-weight: 700; line-height: 1; }
  .bar { height: 6px; border-radius: 3px; background: var(--navy-line); overflow: hidden; }
  .bar > span { display: block; height: 100%; border-radius: inherit; background: var(--lime); }
  .meter-note { color: var(--on-navy-soft); font-size: 13px; }
  main .wrap { padding-block: 32px 48px; display: grid; gap: 40px; }
  /* Grid items default to min-width: auto and would grow with the graph; keep them in the column. */
  main section { min-width: 0; }
  h2 { margin: 0 0 4px; font-size: 20px; font-weight: 700; }
  .section-note { margin: 0 0 16px; color: var(--muted); max-width: 75ch; }
  .graph-frame { overflow-x: auto; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); padding: 16px; }
  .graph-frame:focus-visible { outline: 2px solid var(--edge-done); outline-offset: 2px; }
  svg.graph { display: block; height: auto; max-width: none; }
  .edge { fill: none; stroke: var(--edge); stroke-width: 1.5; }
  .edge.done { stroke: var(--edge-done); stroke-width: 1.75; }
  .edge.todo { stroke-dasharray: 5 4; }
  .arrow-done { fill: var(--edge-done); }
  .arrow-todo { fill: var(--edge); }
  .node rect.box { stroke-width: 1.5; }
  .node.done rect.box { fill: var(--node-done); stroke: var(--node-done); }
  .node.todo rect.box { fill: var(--node-todo); stroke: var(--node-todo-line); stroke-dasharray: 5 4; }
  .node.active rect.box { fill: var(--node-todo); stroke: var(--lime); stroke-width: 3; }
  .node.next rect.box { stroke: var(--lime); stroke-width: 3; stroke-dasharray: none; }
  .node text { font-family: var(--font-sans); }
  .node .id { font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
  .node .name { font-size: 13.5px; font-weight: 600; }
  .node .meta { font-size: 12px; }
  .node.done .id, .node.done .name { fill: var(--node-done-ink); }
  .node.done .meta { fill: var(--node-done-soft); }
  .node.todo .id, .node.todo .name, .node.active .id, .node.active .name { fill: var(--node-todo-ink); }
  .node.todo .meta, .node.active .meta { fill: var(--muted); }
  .node .check, .node .pill { fill: var(--lime); }
  .node .pill-text { fill: var(--on-lime); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 12px; color: var(--muted); font-size: 13px; }
  .legend span { display: inline-flex; align-items: center; gap: 8px; }
  .swatch { width: 22px; height: 14px; border-radius: 3px; border: 1.5px solid; display: inline-block; }
  .swatch.done { background: var(--node-done); border-color: var(--node-done); }
  .swatch.todo { background: var(--node-todo); border-color: var(--node-todo-line); border-style: dashed; }
  .swatch.next { background: var(--node-todo); border-color: var(--lime); border-width: 3px; }
  .streams { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; }
  .stream { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 16px 18px; display: grid; gap: 8px; min-width: 0; align-content: start; }
  .stream-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .stream-title { font-weight: 700; }
  .stream-count { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .stream-chain { font-family: var(--font-mono); font-size: 13px; color: var(--ink-soft); overflow-wrap: break-word; }
  .stream .bar { background: var(--track); }
  .left { display: grid; gap: 12px; }
  .left-item { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 16px 18px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 16px; align-items: baseline; }
  .left-item.next { border: 2px solid var(--lime); }
  .left-id { font-family: var(--font-mono); font-weight: 600; }
  .left-name { font-weight: 600; }
  .left-status { margin-left: 8px; color: var(--muted); font-weight: 400; font-size: 13px; }
  .left-body { grid-column: 2; color: var(--ink-soft); margin: 0; }
  .tag { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: var(--lime); color: var(--on-lime); font-size: 12px; font-weight: 700; vertical-align: 2px; }
  .foot { color: var(--muted); font-size: 13px; margin: 0; }
  .band-head { font-family: var(--font-sans); font-size: 14px; font-weight: 700; fill: var(--ink); }
  .band-head.closed { fill: var(--muted); }
  .band-state { font-size: 12.5px; font-weight: 500; fill: var(--muted); }
  .band-rule { stroke: var(--line); stroke-width: 1; }
  .closed-list { display: grid; gap: 12px; }
  .closed-item { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 16px 18px; display: grid; gap: 6px; min-width: 0; }
  .closed-tag { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--node-done); color: var(--node-done-ink); font-size: 12px; font-weight: 700; white-space: nowrap; }
  .closed-facts { margin: 0; color: var(--muted); font-size: 13px; }
  .closed-summary { grid-column: auto; }
  .closed-streams { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 6px; }
  .closed-streams .stream-count { margin-left: 6px; }
  @media (max-width: 520px) { .left-item { grid-template-columns: 1fr; } .left-body { grid-column: 1; } }
</style>

<header class="band">
  <div class="wrap">
    <div>
      <p class="eyebrow">${esc([milestoneId, milestoneName, `stan na ${longDate(today)}`].filter(Boolean).join(' · '))}</p>
      <h1>${esc(title)}</h1>
      <p class="lede">${esc(lede)}</p>
    </div>
    <div class="meters">
${meters.join('\n')}
    </div>
  </div>
</header>

<main>
  <div class="wrap">
    <section aria-labelledby="graph-title">
      <h2 id="graph-title">Zależności</h2>
      <p class="section-note">Strzałka prowadzi od wymagania wstępnego do pozycji, która na nim stoi.${esc(bandsNote + omittedNote)}</p>
      <div class="graph-frame" tabindex="0" role="region" aria-label="Graf zależności roadmapy, przewijany w poziomie">
        <svg class="graph" width="${svgW}" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-labelledby="svg-title svg-desc">
          <title id="svg-title">Graf zależności: ${esc(title)}</title>
          <desc id="svg-desc">${esc(svgDesc)}</desc>
          <defs>
            <marker id="ad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow-done" d="M0 0 L10 5 L0 10 z"/></marker>
            <marker id="at" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow-todo" d="M0 0 L10 5 L0 10 z"/></marker>
          </defs>
          ${graphSvg}
        </svg>
      </div>
      <div class="legend">
        <span><i class="swatch done"></i>zrobione (data archiwum)</span>
        <span><i class="swatch todo"></i>jeszcze nie zrobione</span>
        <span><i class="swatch next"></i>następne w kolejce</span>
        ${bands.some((b) => b.northStar) ? '<span>★ gwiazda przewodnia</span>' : ''}
        ${streams.length || closedBands.some((c) => c.streams.length) ? '<span>litera po ID: stream danego kamienia milowego</span>' : ''}
      </div>
    </section>
${
  streams.length
    ? `
    <section aria-labelledby="streams-title">
      <h2 id="streams-title">Streamy</h2>
      <p class="section-note">Grupy pozycji, które dzielą łańcuch zależności.</p>
      <div class="streams">
${streamCards}
      </div>
    </section>`
    : ''
}
${
  remaining.length
    ? `
    <section aria-labelledby="left-title">
      <h2 id="left-title">Co zostało${milestoneId ? ` do zamknięcia ${esc(milestoneId)}` : ''}</h2>
      <div class="left">
${remainingCards}
      </div>
    </section>`
    : ''
}
${
  closed.length
    ? `
    <section aria-labelledby="closed-title">
      <h2 id="closed-title">Zamknięte kamienie milowe</h2>
      <p class="section-note">Wykonana wcześniej praca. Pozycje są na grafie pod bieżącym kamieniem milowym.</p>
      <div class="closed-list">
${closedCards}
      </div>
    </section>`
    : ''
}
    <p class="foot">Źródło: context/foundation/roadmap.md (updated ${esc(meta.updated ?? '?')})${testPlan ? ' i context/foundation/test-plan.md §3' : ''}${closed.length ? `; zamknięte kamienie milowe: ${esc(closed.map((c) => `${c.id || c.name} ${c.source}`).join(', '))}` : ''}. Strona generowana skillem /roadmap-project.</p>
  </div>
</main>
`;

writeFileSync(resolve(args.out), html, 'utf8');

const summary = {
  date: today,
  title,
  milestone,
  items: { done: done.length, total: items.length, pct: Math.round(pct(done.length, items.length)) },
  mustHaveFr: mustHave.length
    ? {
        covered: mustHave.length - frMissing.length,
        total: mustHave.length,
        pct: Math.round(pct(mustHave.length - frMissing.length, mustHave.length)),
        missing: frMissing.map((fr) => ({ fr, items: frOwners(fr) })),
        remainingWithoutFr: nonFrRemaining,
      }
    : null,
  testPlan: testPlan ? { ...testPlan, pct: Math.round(pct(testPlan.done, testPlan.total)) } : null,
  streams: streams.map((s) => ({
    name: s.name,
    theme: s.theme,
    done: s.ids.filter((id) => isDone(byId.get(id))).length,
    total: s.ids.length,
  })),
  remaining: remaining.map((it) => ({ id: it.id, title: it.title, status: it.status })),
  next,
  closedMilestones: closed.map((c) => {
    const n = closedNumbers(c);
    return {
      id: c.id,
      name: c.name,
      closed: c.closed,
      items: { done: n.done, total: n.total },
      mustHaveFr: n.frTotal ? { covered: n.frCovered, total: n.frTotal } : null,
      source: c.source,
    };
  }),
  savedClosedMilestones: savedNow,
  omittedTransitiveEdges: omitted,
  out: resolve(args.out),
};
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
