---
change_id: frontend-unit-tests
title: Testy jednostkowe frontendu — faza 1 planu testów (F-03)
status: implemented
created: 2026-11-13
updated: 2026-11-13
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Frontend unit tests (roadmap F-03)".
Risks covered: #3 (form rejects valid amount/date or sends a different value), #2 (guards: server vs browser decisions, signed-out/expired/API-down), #4 (monthly/annual amount differs from hand calculation). Test types planned: unit (+ frontend unit gate in CI).
Risk response intent:
- #3: a table of Polish-format inputs (e.g. 12,99 / 1 299,00 / 29.02.2027 / 31.02.2027) yields the expected value sent to the API or an explicit rejection; oracle from requirements, never copied from the implementation.
- #2: for {server, browser} x {no cookie, valid session, expired session, API down} each guard gives the expected redirect; mock only at the HTTP boundary.
- #4: per-subscription monthly amount matches a hand-calculated value to the grosz.
After creating the folder, follow the downstream continuation rule.
