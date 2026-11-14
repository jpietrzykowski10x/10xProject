---
change_id: agent-loop-hooks
title: Agent-loop hooks — lint, typecheck and unit tests after agent edits
status: implemented
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Open a change folder for rollout Phase 5 of context/foundation/test-plan.md: "Agent-loop hooks".
Risks covered: cross-cutting (no single §2 risk; protects the guards built in Phases 1–4). Test types planned: post-edit hook.
Risk response intent: lint, typecheck and unit tests run after an agent edit and at the end of the agent's turn, so a regression is reported at the moment of the edit instead of in CI; the hook is a local, recommended gate — never a replacement for the required CI gates in §5, and never runs anything slower than a few seconds after each edit (§4 "When NOT to use").
After creating the folder, follow the downstream continuation rule.

### Event check (Phase 1, 2026-11-14)

- (a) `PostToolBatch` fires for a single `Edit` — and after every batch, also `Read`/`Bash`; the filter ends those at once.
- (b) `tool_calls[].tool_input.file_path` exists: absolute, with backslashes on Windows.
- (c) **Fails as intended**: from `PostToolBatch`, both exit 2 + stderr and exit 0 + `{"decision":"block","reason":…}` reach Claude but **end the agent's turn** ("PostToolBatch hook stopped continuation"); the agent cannot fix the regression without a new user prompt.
- Chosen variant: **fallback** — `PostToolUse` with `matcher: "Edit|Write"`, exit 2 + stderr (shown to Claude, the turn continues), and a per-app lock in `.claude/hooks/.state/<app>.lock` so parallel edits check one after another (verified: two parallel runs, 1.3 s and 2.7 s, no overlap).
- (d) **Fails**: `systemMessage` with exit 0 from `PostToolUse` is not shown to the user (checked twice). Stderr with exit 1 is: "PostToolUse:Edit hook error — Failed with non-blocking status code: <stderr>", and Claude does not get it. So user warnings (wrong Node, tool not installed) go to stderr + exit 1. Phase 3 should check whether `systemMessage` from `Stop` is shown before relying on it.
- The temporary probe (log of event, tool and file path only) was removed after the check.

### Stop hook (Phase 3, 2026-11-14)

- `decision: "block"` from `Stop` continues the turn with the report; `systemMessage` from `Stop` **is** shown to the user (unlike `PostToolUse`), so the loop rule uses it as planned.
- Adaptation: the state file keeps the names of the red tools, so a stop right after a block (`stop_hook_active: true`) with no change in between still tells the user "checks still red" instead of staying silent.
- Times: first check of both apps in parallel ≈ 14 s (plan estimated ≤ 10 s), backend alone ≈ 6 s, unchanged state 0.3 s.
- `SUBTRACKER_AGENT_HOOKS=off` in `env` of `.claude/settings.local.json` takes effect only after a session restart (checked: no effect in the running session, both hooks off after `claude --continue`).
