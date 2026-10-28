---
change_id: production-database-wiring
title: Production database wiring
status: impl_reviewed
created: 2026-10-16
updated: 2026-10-28
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- 2026-10-28 — Faza 1 trafiła na `main` i została wypchnięta, zanim serwer był gotowy. Deploy API padł (frontend zwraca 502), produkcja chwilowo nie musi działać; naprawi to Faza 3.
- 2026-10-28 — Od teraz praca na branchu `change/<change-id>`, deploy tylko po merge'u do `main`. Poza planem, osobnym commitem `ci(...)`: nowy `.github/workflows/ci.yml` (lint, testy, build obu aplikacji, `sh -n` skryptów MyDevil) na push do branchy ≠ `main` i na PR do `main`; joby deploy dostały `environment: production` (bramka zatwierdzania, jeśli ustawi się reviewerów w GitHubie). Triggery deployu bez zmian.
- 2026-10-28 — Faza 3 na produkcji: deploy z kopią i migracją `Init`, `/health` OK, CORS OK, ćwiczenie `rollback.sh api` z przywróceniem bazy i ponowny deploy przeszły. Do poprawki przy okazji (kosmetyka skryptów serwerowych): `rollback.sh` pisze „database restored from” przed potwierdzeniem zamiast „will be restored from”; `restore-db.sh` wypisuje wynik `set_config` z odtwarzanego SQL.
- 2026-10-28 — Obie kosmetyczne poprawki zrobione na branchu `fix/deploy-script-messages` (`rollback.sh`: „will be restored from”; `restore-db.sh`: `-o /dev/null` i `client_min_messages=warning`); skrypty trzeba wgrać ręcznie przez `scp`.
- 2026-10-28 — Poza planem: `deploy/mydevil/stop-app.sh` (wołany przez `deploy.sh`, `rollback.sh` i `start-app.sh`). Powstał, bo `forever stop` zawiesił się na godziny na zapętlonym procesie przy przedwczesnym deployu `e0a381a`; daje mu 30 s, potem zabija procesy tej aplikacji po ścieżce.
- 2026-10-28 — Archiwizacja (`da9c3a7`) cofnięta, bo `/10x-impl-review` doszedł dopiero z lekcją m2l3. Przegląd (`reviews/impl-review.md`, fazy 1–3): 10 ustaleń, wszystkie naprawione w triage — kopia pre-restore w `restore-db.sh`, odporność `deploy.sh` na błąd po migracji, `stop-app.sh` czeka i dobija procesy, zasady cytowania `.env`, timeouty bazy, nazwy wydań z własnego SHA, blokada per aplikacja i health-check w `rollback.sh`, walidacja `CORS_ORIGINS`, `shellcheck` w CI. Skrypty serwerowe trzeba wgrać ponownie przez `scp` (wszystkie zmienione: `deploy.sh`, `restore-db.sh`, `rollback.sh`, `stop-app.sh`).
