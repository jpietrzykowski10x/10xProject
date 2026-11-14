---
change_id: backend-e2e-account-isolation
title: Izolacja kont i e2e backendu w CI (test-plan, etap 3)
status: impl_reviewed
created: 2026-11-13
updated: 2026-11-14
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Account isolation and backend e2e in CI".
Risks covered: #1 (IDOR — cudze subskrypcje i kategorie), #5 (sortowanie i unikalność nazw na C.UTF-8), #6 (nadużycie logowania: magic link, wygasła sesja, zalew maili). Test types planned: integration (API e2e), CI gate.
Risk response intent:
- #1: konto B dostaje 404/403 przy każdym odczycie i zapisie zasobu konta A, a lista B nie zawiera danych A; nie wystarczy test na jednym koncie (happy path) ani „zalogowany = uprawniony”.
- #5: w bazie C.UTF-8 (jak produkcja) nazwy różniące się wielkością polskich liter są duplikatem, a sortowanie jest polskie; test nie może biec tylko na lokalnym Polish_Poland.1250.
- #6: drugie użycie linku i link po terminie są odrzucane, wygasła sesja dostaje 401; najpierw sprawdzić, co już pokrywają istniejące e2e, zamiast dopisywać istniejące testy — brakuje ich uruchamiania w CI.
After creating the folder, follow the downstream continuation rule.
