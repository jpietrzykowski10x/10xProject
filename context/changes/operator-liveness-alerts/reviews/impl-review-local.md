<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Alarm o padnięciu API i zadań cyklicznych (S-11), przegląd lokalny po fazie 4

- **Plan**: `context/changes/operator-liveness-alerts/plan.md`
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

Podstawa przeglądu. Fazy 1–3 przeszły siedem przeglądów CI. Ostatni (`impl-review.md`, `74bd38e`) zakończył się wynikiem APPROVED. Od tego commita zmieniły się tylko `deploy.sh` i `rollback.sh` (#69: ostatni wiersz `PORT=`, tak samo jak `port_of` w `watchdog.sh`) oraz dokumenty epilogu (`2d924d4`). Kod `src/` jest bez zmian. Ten przegląd sprawdza tę różnicę i fazę 4 na produkcji, a kryteria automatyczne faz 1–3 uruchamia ponownie.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria

- `npm test` (backend): 42 pliki, 580 testów, wszystkie zielone.
- `shellcheck --shell=sh -S warning deploy/mydevil/*.sh` (tak jak job `deploy-scripts`): czysto.
- 4.1: CI zielone na PR #62 (merge `f02ae98`).
- 4.2–4.5 (serwer, 2026-11-23):
  - `/health` z `jobs: ok`;
  - ręczny przebieg watchdoga kończy się `exit 0` bez maila;
  - z crona: 3 porażki → mail „API nie odpowiada” (12:15), start → mail o powrocie (12:20), `failures: 0`;
  - deploy `workflow_dispatch` (run 45174145722) bez maila i bez wpisu w logu.
- Odkrycie z fazy 4: linie crontaba skopiowane z README z dosłownym `<login>` nie ruszały, bo `/bin/sh` czytał `<login>` jako przekierowanie. Poprawione na serwerze. README ostrzega teraz przed tym w PL i EN (`2d924d4`).

## Findings

### F1 — Ścieżka „pomiń przebieg przy `.ops.lock`” nie była sprawdzona na produkcji

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/operator-liveness-alerts/plan.md:391` (4.5)
- **Detail**: Deploy z 4.5 trwał od 12:25:23 do 12:26:09, czyli między przebiegami crona o 12:25 i 12:30. Wiersz 4.5 jest spełniony, bo alarmu nie było, ale żaden przebieg nie trafił w `.ops.lock`. Pominięcie przebiegu sprawdziła tylko lokalna próba z fazy 3, nie produkcja.
- **Fix**: Zaakceptować. Przy najbliższym deployu API (S-13) zajrzeć do `watchdog.log` i poszukać linii o pominiętym przebiegu, jeśli cron trafi w okno deployu.
- **Decision**: ACCEPTED: sprawdzić `watchdog.log` przy deployu S-13.

### F2 — `@reboot start-all.sh` w README bez przekierowania zaśmieca `/var/mail`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `deploy/mydevil/README.md:254`, `deploy/mydevil/README.md:515`
- **Detail**: Linia `@reboot` w bloku crontaba nie ma `>> … 2>&1`. Ostrzeżenia `forever` (`padLevels`, `util._extend`) po każdym restarcie trafiają więc mailem do `/var/mail`. W fazie 4 ten szum leżał w skrzynce obok prawdziwych błędów z linii `<login>`. To starsza linia, sprzed S-11.
- **Fix**: W README (PL i EN) dopisać do linii `@reboot` `>> /usr/home/<login>/apps/subtracker/api/logs/start-all.log 2>&1`, a operator powtarza to w crontabie na serwerze.
- **Decision**: FIXED: README PL i EN; na serwerze do zrobienia ręcznie (`crontab -e`).
