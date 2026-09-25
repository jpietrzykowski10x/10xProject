# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit — Module 1, Lesson 1

Bootstrap a greenfield project end-to-end with the **shaping chain**:

```
/10x-init  →  /10x-shape  →  /10x-prd  →  (10x-tech-stack-selector)  →  (bootstrapper)
```

The first three skills ship in this lesson; the last two are the next links in the chain.

### Task Router — Where to start

| Skill | Use it when |
| --- | --- |
| **Project setup** | |
| `/10x-init` | The project directory is fresh. Scaffolds `context/foundation/lessons.md` and `docs/reference/contract-surfaces.md` so the rest of the workflow has somewhere to write. Run this once per project. |
| **Discovery** | |
| `/10x-shape` | You have an idea and need to turn it into structured shape-notes BEFORE writing a PRD. Greenfield only. Walks vision → persona/access → MVP → FRs (with Socratic challenge) → business logic & data → stack-openness sketch. Surfaces empty-CRUD and MVP-too-big anti-patterns by name. Output: `context/foundation/shape-notes.md` with a resumable `checkpoint:` block. |
| **Document generation** | |
| `/10x-prd` | You have shape-notes (or raw notes) and want a schema-conformant `context/foundation/prd.md`. Generates against the locked schema, routes every gap verbatim into `## Open Questions`, and refuses to invent domain decisions. On collision, prompts overwrite vs. versioned save (`prd-vN.md`). |

### How the chain hands off

- `/10x-init` produces the workflow v2 scaffold (`context/foundation/`, `lessons.md`, `contract-surfaces.md`). `/10x-shape` requires this and will offer to delegate to `/10x-init` if it's missing.
- `/10x-shape` writes `context/foundation/shape-notes.md` with frontmatter `checkpoint:` (current_phase, phases_completed, frs_drafted, quality_check_status). On re-entry, it resumes from the next unfinished phase.
- `/10x-prd` reads `shape-notes.md` (default) or any path you pass, scores the input on a 4-signal heuristic, warns on thin input, and writes `context/foundation/prd.md` against the schema at `skills/10x-shape/references/prd-schema.md` (frontmatter aligned 1:1 with 10x-tech-stack-selector's Q1–Q7).

### What the PRD captures (and what it does NOT)

- **Captured**: vision, persona, success criteria, user stories (Given/When/Then), FRs (FR-NNN), NFRs, business logic (one-sentence rule first), data model, access control, durable implementation decisions, testing strategy, deployment & CI/CD strategy, non-goals, open questions.
- **NOT captured (deliberate)**: framework choices, database choices, file paths, deployment platform. Stack openness is binding — only `product_type` and `tech_preferences.language_family` capture stack-shaped intent. Frameworks are 10x-tech-stack-selector's job.

### Anti-patterns surfaced during shaping

- **Empty-CRUD**: business logic that reduces to "users add and remove records" with no domain rule. `/10x-shape` names it explicitly and prompts for a real rule shape (recommendation, prioritization, classification, validation, scoring, workflow, calculation).
- **MVP-too-big**: first-flow estimate exceeds ~1 week of after-hours work, or > 4 distinct user actions before user-visible value, or requires multiple integrations before payoff. Skill names the expensive pieces and offers concrete scope-down moves.

Both are **soft gates**: they warn but allow override. Overrides are recorded in the checkpoint and surfaced in the PRD's `## Open Questions`.

### Foundation paths used by this lesson

- `context/foundation/shape-notes.md` — `/10x-shape` output
- `context/foundation/prd.md` (or `prd-vN.md`) — `/10x-prd` output
- `context/foundation/lessons.md` — recurring rules & pitfalls (scaffolded by `/10x-init`)
- `docs/reference/contract-surfaces.md` — load-bearing names registry (scaffolded by `/10x-init`)

### Universal language

The shipped skills carry no 10xDevs / cohort / certification references. The mechanics (Socratic challenge, gray-area discovery, recommended-answer fatigue mitigation, soft quality gate) are universal indicators of a well-scoped greenfield project.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->

## Repository notes (not synced by 10x-cli — safe to edit)

### Current state

This repository has no application code yet. The project is **SubTracker**, a web app for tracking personal subscriptions, with duplicate detection, budget alerts, and a subscription lifecycle state machine. The shaping chain has run: `context/` is scaffolded, and `context/foundation/` holds `shape-notes.md` and `prd.md`. The next step is stack selection (`10x-tech-stack-selector`), which ships in a later lesson and is not installed here yet.

### Where the skills actually live

- `.claude/skills/10x-init/`, `.claude/skills/10x-shape/`, `.claude/skills/10x-prd/`, `.claude/skills/10x-idea-check/` — the shaping-chain skills plus the pre-shaping idea assessor (`/10x-idea-check`, not mentioned in the synced block above — use it before `/10x-shape` when it's unclear whether an idea is worth shaping at all).
- `.agents/skills/10x-cli-setup/` — installs/troubleshoots the `10x` CLI itself (npm/npx runner, auth, course access). Unrelated to the shaping chain; only relevant when the CLI or skill downloads are misbehaving.
- `.claude/skills/10x-shape/references/prd-schema.md` — the single source of truth for `shape-notes.md` and `prd.md` structure. Both `/10x-shape` and `/10x-prd` re-read it at runtime; if it and a SKILL.md ever disagree, the schema wins.

### Skill files are synced, not hand-authored

`skills-lock.json` and `.claude/.10x-cli-manifest.json` track skill provenance (source repo + content hash) for content pulled via the `10x` CLI (`10x get`/`10x sync`). Treat files under `.claude/skills/` and `.agents/skills/` as generated: don't hand-edit them expecting the change to stick — a future sync can overwrite it. If a skill's behavior needs to change, that's an upstream change in `przeprogramowani/10x-cli`.

### Known drift vs. the synced block above

The synced block above describes the toolkit's intended shape but has fallen behind the skill versions actually installed here. When in doubt, read the real `SKILL.md` — it's authoritative, not the summary above:

- `/10x-shape` supports both greenfield and brownfield (auto-detected from repo signals), not "Greenfield only."
- `/10x-init` scaffolds only `context/{changes,archive,foundation}/` + a `README.md` in each. It does **not** create `lessons.md` or `contract-surfaces.md` — those paths mentioned above are aspirational/not yet implemented by the installed skill.
- The PRD schema has no `## Data Model` section (retired) — entities emerge from FRs/User Stories and are pinned downstream, not in the PRD.

### No build/lint/test commands

There's no `package.json` or other manifest — nothing to build, lint, or test yet. That arrives once a stack is chosen (the not-yet-shipped `10x-tech-stack-selector` step after `/10x-prd`).
