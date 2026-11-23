<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Alarm o padnięciu API i zadań cyklicznych (S-11)

- **Plan**: `context/changes/operator-liveness-alerts/plan.md`
- **Scope**: Full plan (CI review on PR #62)
- **Date**: 2026-11-23
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45131018718
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 5 observations

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

To szósty przegląd CI tego PR. Od poprzedniego (run 45080769506, commit `deda3b8`) doszedł tylko merge `origin/main` (`fcd394f`) z PR #68. Wnosi on zmiany w `.github/workflows/ci.yml`, `impl-review.yml` i jedno zdanie w `CLAUDE.md`, które nie należą do diffu tego PR względem `main`. Kod i kontrakty planu się nie zmieniły. Przegląd przeszedł całość od nowa: F1–F4 są wciąż aktualne, a F5 to nowa drobna uwaga o `CLAUDE.md`.

Plan Adherence PASS: wszystkie planowane zmiany z faz 1–4 (12 bloków „Changes Required”) są zgodne z planem. Nie ma odstępstw (DRIFT) ani brakujących zmian (MISSING). Jedyna różnica jest świadoma i zapisana w Notes `change.md`: gdy baza odpowiada, a odczyt `job_run` się nie uda, `/health` zwraca 200 bez `jobs`, a watchdog traktuje to jako porażkę celu `jobs`. Wszystkie pozycje z „What We're NOT Doing” są uszanowane.

Scope Discipline PASS: dodatki spoza listy plików planu służą planowanym zmianom:

- `run-watchdog.ts` i `watchdog-mail.ts` — warstwa I/O i treści maili wydzielone z CLI do testów,
- `firstFailureAt` i `keepUnsent()` w `watchdog-policy.ts` — „czas pierwszej porażki” i „nieudany mail nie zmienia stanu” z planu,
- import `JobsModule` w `app.module.ts`,
- `dev-local/watchdog-trial.mjs` z wpisem w README i `.gitignore`,
- `.run.lock` i `timeout 240` w `watchdog.sh`, opisane w README,
- wpisy w `roadmap.md`.

Safety & Quality PASS: brak problemów krytycznych i ostrzeżeń.

- Oba maile escapują HTML i nie zawierają danych użytkowników ani treści błędów.
- Nazwy zadań w mailu watchdoga pochodzą z `JOB_NAMES`, a nie z odpowiedzi `/health`.
- Migracja tylko dodaje tabelę i indeks `(job, started_at)`. `job_run` nie ma FK.
- `track` nigdy nie odrzuca.
- Plik stanu jest zapisywany atomowo z trybem 0600.
- Próg `stale` 26 h nie daje fałszywego alarmu przy zmianie czasu, bo `cron` przesuwa przebieg o 02:00 na 03:00.
- Zasady projektu są zachowane: bez `any`, importy z `.js`, `shared/process/` zostaje liściem.

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

Celowe uszkodzenia potwierdzone w tym przebiegu, każde cofnięte:

- `JOB_STALE_AFTER_HOURS` 26→27 daje 2 czerwone testy w `src/jobs`,
- `FAILURES_BEFORE_ALERT` 3→4 daje 8 czerwonych testów,
- `REMIND_EVERY_HOURS` 12→13 daje 2 czerwone testy,
- `track` bez zapisu końca przebiegu (`recordFinish`) daje 5 czerwonych testów.

Każde zobowiązanie testowe planu ma swój test: jednostkowe `JobRunService`, `job-run-alert`, `jobHealth`, `installFatalHandlers` i `decide` oraz e2e rejestru przebiegów i `/health`. Browser e2e (`npm run build:e2e && npm run e2e`) nie jest uruchamiany w tym środowisku. Pokrywa go wymagany check `browser-e2e` w `ci.yml` na tym PR.

Ręczne kontrole 1.7, 2.6 i 3.5 są odhaczone i mają pokrycie w kodzie. Faza 4 (4.1–4.5: CI zielone, `/health` z `jobs` po deployu, wgranie `watchdog.sh` i wpis w crontabie, mail przy zatrzymanym API i o powrocie, deploy bez fałszywego alarmu) czeka na człowieka i produkcję. To stan oczekujący, a nie porażka.

Ustaleń, które autor świadomie zostawił albo przeniósł w poprzednich przeglądach, tu nie powtarzam. Są to: trzy zapytania w `latestFinished()`, nazwy zadań w publicznym `/health`, martwa gałąź `skipped`, lekko testowana warstwa I/O watchdoga (zapis stanu, kod wyjścia 1), testy `recordSkipped` w schedulerach i literalne granice 12 h (S-16), limit 240 s przed `writeState` oraz nieatomowe przejęcie `.run.lock`. F3 i F4 to otwarte uwagi z poprzedniego przeglądu, wciąż aktualne.

## Findings

### F1 — Nieudany mail „działa ponownie” zeruje licznik porażek w stanie

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/watchdog/watchdog-policy.ts:101
- **Detail**: Przy akcji `recovered`, `decision.next` to stan zdrowy, więc `keepUnsent` zapisuje `{ failures: 0, alerted: true, lastMailAt: <stary> }`. Ma to dwa skutki:
  - **Ponowiony mail podaje 0 porażek.** `run-watchdog.ts:187` bierze licznik z `previous`, więc ponowiony przy następnym zdrowym sprawdzeniu mail o powrocie podaje „0” nieudanych sprawdzeń.
  - **Nowa awaria może być cicha do 12 h.** Gdy cel padnie znowu, zanim mail o powrocie wyjdzie, `decide` widzi `alerted: true` i wysyła tylko `remind-down` po 12 h od starego `lastMailAt`. Operator i tak nie dostał maila o powrocie, więc uważa, że cel dalej leży, i szkoda jest mała.
- **Fix**: W `keepUnsent` przy `decision.action === 'recovered'` zachować `failures: previous.failures` (analogicznie do `firstFailureAt`) i dopisać przypadek do `watchdog-policy.spec.ts`.
- **Decision**: FIXED: keepUnsent przy nieudanym mailu o powrocie zachowuje licznik porażek (obok firstFailureAt); testy w watchdog-policy.spec.ts i run-watchdog.spec.ts

### F2 — Padnięta baza daje mail „API nie odpowiada”

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/watchdog/run-watchdog.ts:144
- **Detail**: Gdy baza leży, `/health` zwraca 503 `{ status: 'error', db: 'error' }`. Watchdog liczy to jako niezdrowe `api` i wysyła „SubTracker: API nie odpowiada”, choć proces API odpowiada, a problemem jest baza. Alarm przychodzi poprawnie i na czas, ale wprowadza w błąd przy diagnozie. Zgodne z planem („Zdrowy = 2xx z `status: 'ok'`”).
- **Fix**: Przy odpowiedzi 503 z czytelnym `db: 'error'` dopisać do treści maila „baza danych nie odpowiada” albo zostawić to S-12/S-14.
- **Decision**: FIXED: 503 z db: error daje temat „SubTracker: API bez bazy danych” i linię przyczyny; nadal porażka celu api; testy w watchdog-mail.spec.ts i run-watchdog.spec.ts, README PL/EN

### F3 — Linia podsumowania przebiegu nie podaje dnia, dla którego zadanie działało

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/jobs/job-run.service.ts:80
- **Detail**: Ustalenie z poprzedniego przeglądu, nadal otwarte. Przed zmianą scheduler cyklu życia logował `Lifecycle run for ${today}: …`. Teraz jedyną linią jest podsumowanie z `track`, bez dnia w `APP_TIME_ZONE`. Plan wymaga w linii tylko zadania, wyzwalacza, wyniku, liczników i czasu, więc nie jest to odstępstwo od planu.
- **Fix**: Dodać `calendarDayIn(APP_TIME_ZONE, startedAt)` do linii podsumowania albo zostawić to S-14 (format logu).
- **Decision**: FIXED: linia podsumowania „Job <job> (<trigger>) for <dzień w APP_TIME_ZONE>: …”; test granicy północy w job-run.service.spec.ts, backend-patterns.md

### F4 — `port_of` nie zdejmuje apostrofów ani spacji z `PORT`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/watchdog.sh:45
- **Detail**: Ustalenie z poprzedniego przeglądu, nadal otwarte. `tr -d '"\r'` usuwa cudzysłowy i `\r`, ale nie `'` ani końcowe spacje. `.env` z `PORT='3000'` dałby zły port i każdy przebieg kończyłby się błędem widocznym tylko w logu. Parsowanie jest identyczne jak w `deploy.sh`, więc taki `.env` zepsułby też health-check deployu.
- **Fix**: Rozszerzyć filtr do `tr -d "\"' \r"` w obu skryptach naraz albo zostawić jak jest.
- **Decision**: FIXED: filtr tr -d usuwa oba rodzaje cudzysłowów, spacje, tabulatory i `\r` w watchdog.sh, deploy.sh i rollback.sh naraz

### F5 — `CLAUDE.md` nadal mówi, że błąd przebiegu startowego jest „tylko logowany”

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: CLAUDE.md:34
- **Detail**: PR dopisał w tym akapicie zdanie o `JobRunService.track` (wiersz `job_run`, linia podsumowania, mail do operatora przy `failed`/`partial`), ale zostawił wcześniejszy nawias „with the startup run awaited (a failure is only logged)” przy zadaniach z 00:05. Po S-11 błąd jest zapisywany w `job_run` i mailowany, więc akapit przeczy sam sobie. Plan (faza 4) wymaga w `CLAUDE.md` tylko zdania o `job_run`, `/health.jobs` i watchdogu, więc to drobna niedokładność dokumentu, a nie brak.
- **Fix**: Zmienić nawias na np. „(a failure is recorded and mailed, see below)” albo go usunąć.
- **Decision**: FIXED: nawias w CLAUDE.md mówi, że błąd przebiegu startowego nie zatrzymuje startu i jest zapisywany oraz mailowany

<!-- End of report -->
