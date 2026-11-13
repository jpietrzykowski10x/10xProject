---
change_id: test-plan-refresh-2026-11-13
title: Refresh planu testów — testy komponentów frontendu (ryzyko #7, nowa faza 2)
status: archived
created: 2026-11-13
updated: 2026-11-13
archived_at: 2026-11-13T16:01:53Z
---

## Notes

Open a change folder that refreshes context/foundation/test-plan.md (refresh — do not edit the guide in place until the plan's implementation phase).

Trigger: user wants component tests, not only pure-function tests; refresh interview 2026-11-13 (focused on UI).
Refresh brief (accepted by the user):
1. New risk #7: a screen/component fails to render, or a conditional element or validation message does not appear when it should (subscription form: trial end field, own-category field, errors under fields after a save attempt). Impact High, Likelihood High. Source: refresh interview Q1 (component not shown/loaded, validation messages missing), Q3 (changes everywhere, new components keep coming; element visible in the right state), Q4 (subscription form: conditional fields and validation messages first); hot-spot dir frontend-subtracker/src/app/pages (67 file changes / 30 days, top of scope); archive S-02 (amount bug visible only in the UI).
2. Risk Response Guidance #7: prove — for each form state the element is present/absent and a validation message is visible after invalid input + save attempt (not its exact text); every component can be created. Must challenge — "validator unit tests prove the message is shown"; "should create proves the form works". Context for research — when Material shows errors (touched/submit), how conditional controls are enabled/disabled, whether Angular Material test harnesses fit. Cheapest layer — component test (TestBed + jsdom, same runner as Phase 1), API replaced only at the HTTP boundary. Anti-patterns — asserting exact message text, pixel/position checks or snapshots, mocking form internals.
3. New §3 phase "Frontend component tests" inserted as Phase 2 (current Phases 2–4 become 3–5; none started). Risks #7, #3. Test type: component.
4. §5: component tests run inside the existing "unit frontend" gate (no new gate).
5. §6: new cookbook entry "Adding a component test"; a "should create" smoke test is the minimum for every new component (user: keep it — proves the component can be used at all).
6. §7: add — no assertions on exact message text (text may evolve, it must be visible on error) and no checks of element position/spacing relative to each other.
7. To decide in the refresh plan: switching skipTests: true in angular.json so new components get a "should create" spec; a roadmap note, since F-03 excludes component tests.
Unchanged: §1, risks #1–#6; rollout Phase 1 (frontend-unit-tests) continues on its own plan.

(The command argument carried only the first line; the rest of the accepted brief is copied from the /10x-test-plan --refresh handoff of the same session.)
