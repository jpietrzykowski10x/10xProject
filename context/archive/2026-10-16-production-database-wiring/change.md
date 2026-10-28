---
change_id: production-database-wiring
title: Production database wiring
status: archived
created: 2026-10-16
updated: 2026-10-28
archived_at: 2026-10-28T14:53:29Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- 2026-10-28 — Faza 1 trafiła na `main` i została wypchnięta, zanim serwer był gotowy. Deploy API padł (frontend zwraca 502), produkcja chwilowo nie musi działać; naprawi to Faza 3.
- 2026-10-28 — Od teraz praca na branchu `change/<change-id>`, deploy tylko po merge'u do `main`. Poza planem, osobnym commitem `ci(...)`: nowy `.github/workflows/ci.yml` (lint, testy, build obu aplikacji, `sh -n` skryptów MyDevil) na push do branchy ≠ `main` i na PR do `main`; joby deploy dostały `environment: production` (bramka zatwierdzania, jeśli ustawi się reviewerów w GitHubie). Triggery deployu bez zmian.
- 2026-10-28 — Faza 3 na produkcji: deploy z kopią i migracją `Init`, `/health` OK, CORS OK, ćwiczenie `rollback.sh api` z przywróceniem bazy i ponowny deploy przeszły. Do poprawki przy okazji (kosmetyka skryptów serwerowych): `rollback.sh` pisze „database restored from” przed potwierdzeniem zamiast „will be restored from”; `restore-db.sh` wypisuje wynik `set_config` z odtwarzanego SQL.
- 2026-10-28 — Obie kosmetyczne poprawki zrobione na branchu `fix/deploy-script-messages` (`rollback.sh`: „will be restored from”; `restore-db.sh`: `-o /dev/null` i `client_min_messages=warning`); skrypty trzeba wgrać ręcznie przez `scp`.
