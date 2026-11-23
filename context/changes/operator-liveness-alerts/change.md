---
change_id: operator-liveness-alerts
title: Operator liveness alerts
status: impl_reviewed
created: 2026-11-22
updated: 2026-11-23
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmapa: S-11 (M-2, gwiazda przewodnia), PRD v2 FR-019.
- Źródło ustaleń: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (P1, J1, J2, J3, J4; §6 pkt 1).
- Gałąź `change/operator-liveness-alerts` założona od `chore/10x-m3-observability` (audyt + PRD v2 + roadmapa M-2), nie od `origin/main`: chore trzeba zmergować najpierw.
- Decyzja z implementacji (przegląd CI F2): gdy baza odpowiada, ale odczyt `job_run` się nie uda, `/health` zwraca 200 bez pola `jobs` (z linią w logu); watchdog traktuje brak albo niepoprawne `jobs` jako porażkę celu `jobs` (mail „stan zadań cyklicznych nieczytelny”). Zadanie `failed` nie jest porażką watchdoga, bo mailuje je samo API.
- Przegląd CI (PR #62, `reviews/impl-review.md`): F3 poprawione (blokada `.run.lock` w `watchdog.sh`); F1 poprawione (test e2e `partial` przypomnień w `test/jobs/job-run.e2e-spec.ts`); F4–F8 zostawione albo do S-14/S-16.
- Drugi przegląd CI (PR #62, `cedae22`): F1 (osierocona `.run.lock`) i F2 (brak limitu czasu przebiegu) poprawione w `watchdog.sh` (przejęcie blokady starszej niż 15 min, `timeout 240`) i opisane w README; F3 (brak testów ścieżki `recordSkipped` w schedulerach) przeniesione do S-16 (Notes w roadmapie).
- Szósty przegląd CI (PR #62, `d08be22`, APPROVED, 5 obserwacji): wszystkie poprawione w tym PR, decyzje w `reviews/impl-review.md`. F1: nieudany mail o powrocie zachowuje licznik porażek; F2: 503 z `db: error` daje mail „API bez bazy danych”; F3: dzień (`APP_TIME_ZONE`) w linii podsumowania przebiegu; F4: odczyt `PORT` w `watchdog.sh`, `deploy.sh` i `rollback.sh` usuwa oba rodzaje cudzysłowów i białe znaki; F5: zdanie o przebiegu startowym w `CLAUDE.md`. Na serwer w fazie 4 trzeba więc wgrać także nowe `deploy.sh` i `rollback.sh`.
- Siódmy przegląd CI (PR #62, `74bd38e`, APPROVED, 3 obserwacje), PR zmergowany w tym stanie: F1 poprawione po merge'u w `chore/port-last-line` (ostatni wiersz `PORT=` w `deploy.sh` i `rollback.sh`), F2 i F3 zostawione z uzasadnieniem w `reviews/impl-review.md`.
