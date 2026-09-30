# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit — Module 1, Lesson 3

Scaffold the project for the stack you picked in Lesson 2, with the **bootstrap chain**:

```
(/10x-init  →  /10x-shape  →  /10x-prd)  →  /10x-tech-stack-selector  →  /10x-bootstrapper
```

The PRD chain ships from Lesson 1 and the tech-stack-selector ships from Lesson 2 — both re-included in this lesson so you can fix the PRD or swap the stack mid-flight. `/10x-bootstrapper` is the lesson's main topic. The chain ends here in v1; a future Lesson 4 will set up agent context (`CLAUDE.md`, `AGENTS.md`).

### Task Router — Where to start

| Skill | Use it when |
| --- | --- |
| **Bootstrap (lesson focus)** | |
| `/10x-bootstrapper` | You have a hand-off at `context/foundation/tech-stack.md` (written by `/10x-tech-stack-selector`) and you are ready to scaffold the project into the current directory. The skill reads the hand-off, looks up the chosen card in the starter registry, runs its CLI through one of three cwd strategies (scaffold into a temp directory then move files up; scaffold directly into the current directory; clone a starter repo without keeping its git history), preserves `context/` always, sidelines other clashes as `.scaffold` siblings, runs a light pre-scaffold recency check and a deeper post-scaffold audit, and writes a verification log to `context/changes/bootstrap-verification/verification.md`. Use AFTER `/10x-tech-stack-selector`. |
| **Re-run upstream if needed** | |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` | Bundled so you can fix the PRD or swap the stack mid-flight. If `/10x-bootstrapper` surfaces a registry-drift refusal or you change your mind on the starter, re-run `/10x-tech-stack-selector` to regenerate `tech-stack.md` and re-invoke. |

### How the chain hands off

- `/10x-tech-stack-selector` (Lesson 2) writes `context/foundation/tech-stack.md` with a 4-key frontmatter (`starter_id`, `package_manager`, `project_name`, `hints`) plus a one-paragraph `## Why this stack` body.
- `/10x-bootstrapper` reads that file FULLY (no fallback to conversation history). If it is absent, the skill refuses with a one-sentence redirect to `/10x-tech-stack-selector` and stops — no inline mini-handoff, no standalone-mode in v1.
- The chosen `starter_id` is looked up in `/skills/10x-tech-stack-selector/references/starter-registry.yaml`. The skill consumes that registry; it does not own it. A CI validator (`scripts/validate-starter-registry-sync.mjs`) prevents bootstrapper from referencing a `starter_id` absent from the registry.
- The skill writes `context/changes/bootstrap-verification/verification.md` as the audit-trail log for the run. Schema in `/skills/10x-bootstrapper/references/verification-log-schema.md`.

### What bootstrapper captures (and what it does NOT)

- **Captured (v1)**: scaffold via the chosen card's `cmd_template` (CLI delegation, not inline file generation), three cwd strategies dispatched from `bootstrapper-config.yaml` (`subdir-then-move`, `native-cwd`, `git-clone`), strict conflict policy producing `.scaffold` siblings + always preserving `context/`, two verification slots (light pre-scaffold recency check + deep post-scaffold language-aware audit), severity-tiered audit summary, full verification log on disk.
- **NOT captured in v1 (deliberate)**: `AGENTS.md` / `CLAUDE.md` generation (deferred to a future Lesson 4 — "Memory Architecture"); per-starter cert-element placement overlays (live with the future agent-context skill, not here); CI workflow files; AI-as-bridge fallback for stacks outside the registry (deferred to v2 — in v1 chain-mode tech-stack-selector already gates on the registry, so the case cannot arise); standalone-mode where the user names a stack inline without a hand-off (deferred to v2); compensation actions for `bootstrapper_confidence: best-effort` or `quality_override: true` (surfaced in conversation but no automated follow-up — that, too, is the future memory-architecture skill's job).

### The conflict policy

When the skill moves files from a temp scaffold directory up into your current working directory, it applies a strict matrix:

- **`context/**`** — anything the scaffold tried to write under `context/` is **dropped**. Your `context/` is the source of truth for the bootstrap chain (PRD, tech-stack hand-off, plans, frames) and is never overwritten.
- **`.gitignore`** — append-merged: your existing lines stay in order, then the scaffold's lines are de-duped against your set and appended with a separator comment. Git's ignore semantics are additive, so combining is safe.
- **`package.json`, `README.md`, `CLAUDE.md`, `AGENTS.md`, root-level `*.md`** — your existing file wins; the scaffold's copy lands as `<filename>.scaffold` sibling. You can `diff README.md README.md.scaffold` to see what the starter shipped vs what you had.
- **Anything else** — moves silently if no conflict, sidelined as `<filename>.scaffold` if there is one. The matrix never deletes user files.

For the `git-clone` strategy (10x-astro-starter and similar): the cloned `.git/` is deleted before move-up, so the upstream starter's history does not leak into your repo. You initialise your own history afterwards (`git init`).

### Verification log

Every run writes `context/changes/bootstrap-verification/verification.md`. Sections:

- **`## Hand-off`** — verbatim copy of the tech-stack.md frontmatter and `## Why this stack` body.
- **`## Pre-scaffold verification`** — recency findings table (npm package version + `time.modified` for JS starters; GitHub `pushed_at` for any starter with a GitHub `docs_url`).
- **`## Scaffold log`** — the resolved CLI invocation, exit code, files moved, conflicts surfaced as `.scaffold` siblings, `.gitignore` handling.
- **`## Post-scaffold audit`** — full per-language audit output (`npm audit --json` for JS, `pip-audit` for Python, `cargo audit` for Rust, etc.). Severity-tiered: CRITICAL and HIGH surfaced inline in chat, MODERATE and LOW log-only. Direct-vs-transitive split where the tool supports it.
- **`## Hints recorded but not acted on`** — every hint from the hand-off bootstrapper read but did not act on in v1. Audit-trail completeness for the future memory-architecture skill.
- **`## Next steps`** — pointer text. v1 names "your project is scaffolded and verified — happy hacking" and flags the future Lesson 4 skill as the next chain link.

The folder (`context/changes/bootstrap-verification/`) deliberately has no `change.md`. Bootstrap runs are one-shot artifacts, not tracked workflow changes — the folder hosts the log and nothing else. Re-runs apply a warn-and-confirm guard before overwriting; the escape hatch is `verification-v2.md` (and so on).

### Foundation paths used by this lesson

- `context/foundation/tech-stack.md` — input (from Lesson 2)
- `context/changes/bootstrap-verification/verification.md` — output (the audit-trail log)
- `context/foundation/lessons.md` — recurring rules & pitfalls
- `docs/reference/contract-surfaces.md` — load-bearing names registry

### Universal language

The shipped skill carries no 10xDevs / cohort / certification references. The post-scaffold audit dispatches by `language_family` against a small lookup table; cohorts whose stack lands in `java`, `php`, `dart`, or a multi-language combination see a "no built-in audit tool for this ecosystem" log line and a recommended external tool, not a fake "0 findings" record.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->

## Repository notes (not synced by 10x-cli — safe to edit)

### Current state

This repository has no application code yet. The project is **SubTracker**, a web app for tracking personal subscriptions, with duplicate detection, budget alerts, and a subscription lifecycle state machine. The shaping chain and stack selection have run: `context/foundation/` holds `shape-notes.md`, `prd.md`, and `tech-stack.md`. The chosen stack is an Angular (SSR) frontend plus a NestJS API as two separate apps in this repo (no monorepo tooling), PostgreSQL + TypeORM, self-hosted on MyDevil (FreeBSD) with GitHub Actions auto-deploying over SSH — `tech-stack.md` is the source of truth for the details. The next step is scaffolding with `/10x-bootstrapper`, which ships in a later lesson and is not installed here yet.

### Where the skills actually live

- `.claude/skills/10x-init/`, `.claude/skills/10x-shape/`, `.claude/skills/10x-prd/`, `.claude/skills/10x-idea-check/` — the shaping-chain skills plus the pre-shaping idea assessor (`/10x-idea-check`, not mentioned in the synced block above — use it before `/10x-shape` when it's unclear whether an idea is worth shaping at all).
- `.agents/skills/10x-cli-setup/` — installs/troubleshoots the `10x` CLI itself (npm/npx runner, auth, course access). Unrelated to the shaping chain; only relevant when the CLI or skill downloads are misbehaving.
- `.claude/skills/10x-tech-stack-selector/` — stack selection; its `references/starter-registry.yaml` is the canonical starter registry that `/10x-bootstrapper` will read.
- `.claude/skills/10x-stack-assess/` — brownfield counterpart: scores an existing stack against the same four agent-friendly gates. Not needed for this greenfield project.
- `.claude/skills/10x-shape/references/prd-schema.md` — the single source of truth for `shape-notes.md` and `prd.md` structure. Both `/10x-shape` and `/10x-prd` re-read it at runtime; if it and a SKILL.md ever disagree, the schema wins.

### Skill files are synced, not hand-authored

`skills-lock.json` and `.claude/.10x-cli-manifest.json` track skill provenance (source repo + content hash) for content pulled via the `10x` CLI (`10x get`/`10x sync`). Treat files under `.claude/skills/` and `.agents/skills/` as generated: don't hand-edit them expecting the change to stick — a future sync can overwrite it. If a skill's behavior needs to change, that's an upstream change in `przeprogramowani/10x-cli`.

### Known drift vs. the synced block above

The synced block above describes the toolkit's intended shape but has fallen behind the skill versions actually installed here. When in doubt, read the real `SKILL.md` — it's authoritative, not the summary above:

- `/10x-init` scaffolds only `context/{changes,archive,foundation}/` + a `README.md` in each. It does **not** create `lessons.md` or `contract-surfaces.md` — those paths mentioned above are aspirational/not yet implemented by the installed skill.
- `/10x-bootstrapper` is referenced as the next link but is not installed here yet.

### No build/lint/test commands

There's no `package.json` or other manifest — nothing to build, lint, or test yet. That arrives once `/10x-bootstrapper` scaffolds the Angular and NestJS apps from `tech-stack.md`.
