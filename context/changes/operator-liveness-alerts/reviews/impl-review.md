<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Alarm o padnięciu API i zadań cyklicznych (S-11)

- **Plan**: `context/changes/operator-liveness-alerts/plan.md`
- **Scope**: Full plan (CI review on PR #62)
- **Date**: 2026-11-22
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45079661203
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Test Coverage       | PASS    |
| Success Criteria    | PASS    |

To czwarty przegląd CI tego PR. Od poprzedniego (run 45078954120, commit `00b9ae8`) doszedł tylko `73f2816`: jedno zdanie w Notes S-16 w `context/foundation/roadmap.md`, które przenosi tam F3 z poprzedniego przeglądu (literalne granice 12 h w testach `decide`). Kod, kontrakty planu i opisane zachowanie się nie zmieniły.

Plan Adherence PASS: wszystkie 22 planowane zmiany z faz 1–4 są zgodne z planem, bez DRIFT i bez MISSING. Jedyna różnica jest świadoma i zapisana w Notes `change.md`: gdy baza działa, a odczyt `job_run` się nie uda, `/health` zwraca 200 bez `jobs` (przy błędzie bazy nadal 503). Wszystkie pozycje z „What We're NOT Doing” są uszanowane: brak `enableShutdownHooks`, `/health` bez zmiany kodu przy złych jobach, brak widoku w UI admina i zewnętrznego monitora.

Scope Discipline PASS: dodatki spoza listy plików planu służą planowanym zmianom albo poprawiają ustalenia poprzednich przeglądów:

- `run-watchdog.ts` i `watchdog-mail.ts` — warstwa I/O i maila wydzielona z CLI do testów,
- `dev-local/watchdog-trial.mjs` — pomocnik ręcznej próby zgodny z zasadami `dev-local/`,
- importy `JobsModule` w `app.module.ts`, `auth.module.ts`, `subscriptions.module.ts`,
- `.run.lock`, przejęcie osieroconej blokady i `timeout 240` w `watchdog.sh` (opisane w README PL i EN),
- wpisy w `roadmap.md`.

Safety & Quality PASS: bez nowych problemów. Escapowanie HTML w obu mailach, brak danych użytkowników i treści błędów w mailach, migracja tylko tworzy tabelę i indeks `(job, started_at)` (bez FK, więc reguła indeksów FK nie dotyczy), brak `any`, importy z `.js`, `shared/process/` pozostaje liściem. `track` i `recordSkipped` łapią każdy błąd zapisu, więc rejestr nie wywraca zadania ani startu. Dwie drobne uwagi niżej (F1, F2).

Success Criteria — polecenia uruchomione w tym przebiegu CI:

| Polecenie                                                            | Wynik                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm test`                                                           | ✅ exit 0 — 42 pliki, 572 testy                                                            |
| `npm run test:e2e`                                                   | ✅ exit 0 — 23 pliki, 199 testów                                                           |
| `npx vitest run src/jobs src/shared/process src/health src/watchdog` | ✅ exit 0 — 8 plików, 83 testy                                                             |
| `npm run migration:show`                                             | ✅ exit 0 — `[X] JobRun1795371489074` zastosowana                                          |
| `npm run lint`                                                       | ✅ exit 0 — ostrzeżenia `unbound-method` tylko w istniejących, niezmienionych plikach spec |
| `npm run build`                                                      | ✅ exit 0 — `dist/cli/watchdog.js` w buildzie                                              |
| `shellcheck --shell=sh -S warning deploy/mydevil/*.sh`               | ✅ exit 0 — czysto                                                                         |

Celowe uszkodzenia potwierdzone, każde cofnięte:

- `JOB_STALE_AFTER_HOURS` 26→27 daje 4 czerwone testy,
- `FAILURES_BEFORE_ALERT` 3→4 daje 8 czerwonych testów,
- `REMIND_EVERY_HOURS` 12→13 daje 2 czerwone testy,
- `track` bez zapisu wyniku daje 5 czerwonych testów jednostkowych i 5 z 7 testów e2e `test/jobs/job-run.e2e-spec.ts`.

Każde zobowiązanie testowe planu ma swój test (jednostkowe `JobRunService`, `job-run-alert`, `jobHealth`, `installFatalHandlers`, `decide`; e2e rejestru przebiegów i `/health`).

Browser e2e (`npm run build:e2e && npm run e2e`) nie jest uruchamiany w tym środowisku. Pokrywa go wymagany check `browser-e2e` w `ci.yml` na tym PR.

Ręczne kontrole: 1.7, 2.6 i 3.5 są odhaczone i mają pokrycie w kodzie. Faza 4 (4.1–4.5) czeka na człowieka i produkcję — to stan oczekujący, a nie porażka:

- 4.1: CI zielone na PR,
- 4.2: `/health` z `jobs` na serwerze po deployu,
- 4.3: wgranie `watchdog.sh` (`scp`, `chmod 700`, `sha256`) i wpis w crontabie,
- 4.4: mail przy zatrzymanym API i mail o powrocie,
- 4.5: deploy bez fałszywego alarmu.

Ustaleń, które autor świadomie zostawił albo przeniósł w poprzednich przeglądach, tu nie powtarzam: trzy zapytania w `latestFinished()`, nazwy zadań w publicznym `/health`, martwa gałąź `skipped`, lekko testowana warstwa I/O watchdoga, testy `recordSkipped` i literalne granice 12 h (S-16), limit 240 s przed `writeState` i nieatomowe przejęcie `.run.lock`.

## Findings

### F1 — Linia podsumowania przebiegu nie podaje już dnia, dla którego zadanie działało

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/jobs/job-run.service.ts:80
- **Detail**: Przed zmianą scheduler cyklu życia logował `Lifecycle run for ${today}: …`. Teraz jedyną linią jest podsumowanie z `track` (`Job <job> (<trigger>): <outcome> in <ms> ms …`), bez dnia w `APP_TIME_ZONE`. Mail do operatora ma dzień, ale przy przebiegu startowym tuż po północy w logu trudniej odróżnić, który dzień kalendarzowy był przetwarzany. Plan wymaga w linii logu tylko zadania, wyzwalacza, wyniku, liczników i czasu, więc to nie jest odstępstwo od planu.
- **Fix**: Dodać `calendarDayIn(APP_TIME_ZONE, startedAt)` do linii podsumowania albo zostawić to S-14 (format logu).
- **Decision**: PENDING

### F2 — `port_of` nie zdejmuje apostrofów ani spacji z `PORT`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/watchdog.sh:45
- **Detail**: `sed -n 's/^PORT=//p' | tail -n 1 | tr -d '"\r'` usuwa cudzysłowy i `\r`, ale nie `'` ani końcowe spacje. `.env` z `PORT='3000'` dałby zły port i każdy przebieg watchdoga kończyłby się błędem widocznym tylko w logu, bez maila. Parsowanie jest identyczne jak w `deploy.sh:57`, więc taki `.env` zepsułby też health-check deployu — ryzyko istnieje tylko przy zmianie formatu `.env`.
- **Fix**: Rozszerzyć filtr do `tr -d "\"' \r"` (w obu skryptach naraz) albo zostawić jak jest.
- **Decision**: PENDING

<!-- End of report -->
