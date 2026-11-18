#!/usr/bin/env node
// Builds the roadmap progress page (one self-contained HTML file) from context/foundation/roadmap.md
// and, when present, the §3 Phased Rollout table of context/foundation/test-plan.md. Prints a JSON
// summary of the percentages to stdout. No dependencies; run from the repository root:
//
//   node .claude/skills/roadmap-project/scripts/build-roadmap-page.mjs --out <file.html>
//        [--next <ID>] [--title "<page title>"] [--date YYYY-MM-DD] [--root <repo dir>]
//
// Exit codes: 0 ok, 2 no roadmap, 1 any other error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

const meta = frontmatter(roadmap);

// Items: every "### F-NN: Title" / "### S-NN: Title" block, in document order.
const items = [];
const blockRe = /^### ([FS]-\d{2,}): (.+)$/gm;
const heads = [...roadmap.matchAll(blockRe)];
heads.forEach((m, i) => {
  const from = m.index;
  const nextHead = heads[i + 1]?.index ?? roadmap.length;
  // The block ends at the next item heading or the next "## " section, whichever comes first;
  // the search starts after the heading line, which itself contains "## ".
  const bodyStart = from + m[0].length;
  const nextSection = roadmap.slice(bodyStart).search(/^## /m);
  const to = nextSection < 0 ? nextHead : Math.min(nextHead, bodyStart + nextSection);
  const block = roadmap.slice(from, to);
  items.push({
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
if (items.length === 0) {
  process.stderr.write('The roadmap has no "### F-NN:" / "### S-NN:" items.\n');
  process.exit(1);
}
const byId = new Map(items.map((it) => [it.id, it]));
for (const it of items) it.prereqs = it.prereqs.filter((p) => byId.has(p) && p !== it.id);

// Archive dates from "## Done": "- **S-08: …** — Archived 2026-11-18 → …".
for (const line of section(roadmap, 'Done').split('\n')) {
  const m = /\*\*([FS]-\d{2,}):[\s\S]*?Archived (\d{4}-\d{2}-\d{2})/.exec(line);
  if (m && byId.has(m[1])) byId.get(m[1]).archived = m[2];
}

// Milestone name and must-have FRs ("Scope anchors", before "Nice-to-have").
const milestoneText = section(roadmap, 'Milestone');
const milestoneMatch = /\*\*([^*]+?)\*\*\s*—\s*Status:\s*(\w+)/.exec(milestoneText);
const milestone = milestoneMatch ? milestoneMatch[1].trim() : '';
const anchors = field(milestoneText, 'Scope anchors').split(/Nice-to-have/i)[0];
const mustHave = [...new Set(anchors.match(/FR-\d+/g) ?? [])];

// North star: the first ID under "## North star".
const northStar = idsIn(section(roadmap, 'North star'))[0] ?? null;

// Streams table.
const streams = tableRows(section(roadmap, 'Streams'))
  .map((row) => ({
    name: row.stream ?? '',
    theme: row.theme ?? '',
    ids: idsIn(row.chain ?? '').filter((id) => byId.has(id)),
    chain: (row.chain ?? '').replace(/`/g, ''),
  }))
  .filter((s) => s.name && s.ids.length > 0);
for (const s of streams) for (const id of s.ids) byId.get(id).stream ??= s.name;

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

// Transitive reduction: drop u→v when v is reachable from u another way.
function reachable(from, target, skipDirect) {
  const stack = byId.get(from).prereqs.filter((p) => !(skipDirect && p === target));
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...byId.get(cur).prereqs);
  }
  return false;
}
const omitted = [];
for (const it of items) {
  const kept = it.prereqs.filter((p) => !reachable(it.id, p, true));
  for (const p of it.prereqs) if (!kept.includes(p)) omitted.push(`${p} → ${it.id}`);
  it.parents = kept;
}
for (const it of items) it.children = items.filter((c) => c.parents.includes(it.id)).map((c) => c.id);

// Depth = longest path from a root.
const depthMemo = new Map();
function depth(id, trail = new Set()) {
  if (depthMemo.has(id)) return depthMemo.get(id);
  if (trail.has(id)) return 0; // cycle guard
  trail.add(id);
  const it = byId.get(id);
  const d = it.parents.length ? 1 + Math.max(...it.parents.map((p) => depth(p, trail))) : 0;
  trail.delete(id);
  depthMemo.set(id, d);
  return d;
}
for (const it of items) it.depth = depth(it.id);
const maxDepth = Math.max(...items.map((it) => it.depth));
const columns = Array.from({ length: maxDepth + 1 }, (_, d) => items.filter((it) => it.depth === d));

const W = 184;
const H = 84;
const COL_GAP = 40;
const ROW = H + 18;
const order = new Map(items.map((it, i) => [it.id, i]));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

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
    column.map((it) => [it.id, it.parents.length ? mean(it.parents.map((p) => byId.get(p).y)) : 0]),
  );
  place(column, desired);
}
for (let d = columns.length - 2; d >= 0; d -= 1) {
  const desired = new Map(
    columns[d].map((it) => [
      it.id,
      it.children.length ? mean(it.children.map((c) => byId.get(c).y)) : it.y,
    ]),
  );
  place(columns[d], desired);
}
const TOP = 34;
const minY = Math.min(...items.map((it) => it.y));
for (const it of items) {
  it.y = Math.round(it.y - minY + TOP);
  it.x = 20 + it.depth * (W + COL_GAP);
}
const svgW = 20 + (maxDepth + 1) * (W + COL_GAP) - COL_GAP + 20;
const svgH = Math.max(...items.map((it) => it.y)) + H + 20;

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

function nodeSvg(it) {
  const cls = isDone(it) ? 'done' : it.status === 'in-progress' ? 'active' : 'todo';
  const nextCls = it.id === next ? ' next' : '';
  const label = `${it.id}${it.id === northStar ? ' ★' : ''}${it.stream ? ` · ${it.stream}` : ''}`;
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

const edges = items.flatMap((it) => it.parents.map((p) => edgeSvg(byId.get(p), it)));
const svgDesc =
  items
    .map((it) => `${it.id} (${statusPl(it.status)})${it.parents.length ? ` zależy od ${it.parents.join(', ')}` : ''}`)
    .join('; ') + '.';

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
      <p class="section-note">Strzałka prowadzi od wymagania wstępnego do pozycji, która na nim stoi.${esc(omittedNote)}</p>
      <div class="graph-frame" tabindex="0" role="region" aria-label="Graf zależności roadmapy, przewijany w poziomie">
        <svg class="graph" width="${svgW}" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-labelledby="svg-title svg-desc">
          <title id="svg-title">Graf zależności: ${esc(title)}</title>
          <desc id="svg-desc">${esc(svgDesc)}</desc>
          <defs>
            <marker id="ad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow-done" d="M0 0 L10 5 L0 10 z"/></marker>
            <marker id="at" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow-todo" d="M0 0 L10 5 L0 10 z"/></marker>
          </defs>
          ${edges.join('\n          ')}
          ${items.map(nodeSvg).join('\n          ')}
        </svg>
      </div>
      <div class="legend">
        <span><i class="swatch done"></i>zrobione (data archiwum)</span>
        <span><i class="swatch todo"></i>jeszcze nie zrobione</span>
        <span><i class="swatch next"></i>następne w kolejce</span>
        ${northStar ? '<span>★ gwiazda przewodnia</span>' : ''}
        ${streams.length ? `<span>${esc(streams.map((s) => s.name).join('–'))}: stream</span>` : ''}
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
    <p class="foot">Źródło: context/foundation/roadmap.md (updated ${esc(meta.updated ?? '?')})${testPlan ? ' i context/foundation/test-plan.md §3' : ''}. Strona generowana skillem /roadmap-project.</p>
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
  omittedTransitiveEdges: omitted,
  out: resolve(args.out),
};
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
