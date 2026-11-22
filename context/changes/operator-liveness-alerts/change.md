---
change_id: operator-liveness-alerts
title: Operator liveness alerts
status: impl_reviewed
created: 2026-11-22
updated: 2026-11-22
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmapa: S-11 (M-2, gwiazda przewodnia), PRD v2 FR-019.
- Źródło ustaleń: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (P1, J1, J2, J3, J4; §6 pkt 1).
- Gałąź `change/operator-liveness-alerts` założona od `chore/10x-m3-observability` (audyt + PRD v2 + roadmapa M-2), nie od `origin/main`: chore trzeba zmergować najpierw.
- Decyzja z implementacji (przegląd CI F2): gdy baza odpowiada, ale odczyt `job_run` się nie uda, `/health` zwraca 200 bez pola `jobs` (z linią w logu); watchdog traktuje brak albo niepoprawne `jobs` jako porażkę celu `jobs` (mail „stan zadań cyklicznych nieczytelny”). Zadanie `failed` nie jest porażką watchdoga, bo mailuje je samo API.
- Przegląd CI (PR #62, `reviews/impl-review.md`): F3 poprawione (blokada `.run.lock` w `watchdog.sh`); F1 (test e2e `partial` w przypomnieniach) do zrobienia przed merge'em; F4–F8 zostawione albo do S-14/S-16.
