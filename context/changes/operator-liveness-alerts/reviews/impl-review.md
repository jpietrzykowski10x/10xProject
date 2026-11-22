<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Alarm o padnięciu API i zadań cyklicznych (S-11)

- **Plan**: `context/changes/operator-liveness-alerts/plan.md`
- **Scope**: Full plan (CI review on PR #62)
- **Date**: 2026-11-22
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45078954120
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

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

To trzeci przegląd CI tego PR. Od poprzedniego (run 45075848606, commit `cedae22`) doszedł tylko `9d5c457`: w `deploy/mydevil/watchdog.sh` blokada `.run.lock` starsza niż 15 minut jest przejmowana z wpisem w logu, inny błąd `mkdir` kończy przebieg kodem 1, a `node cli/watchdog.js` działa pod `timeout 240` (kod 124 z wpisem w logu). Opis trafił do README (PL i EN), a notatki do `change.md` i `roadmap.md`. Poprzednie F3 (brak testów ścieżki `recordSkipped` w schedulerach) autor jawnie przeniósł do S-16.

Plan Adherence PASS: każdy kontrakt faz 1–4 jest zgodny z planem, bez braków. Należą do nich:

- encja i migracja `job_run` z indeksem `(job, started_at)`,
- `track()`, `recordSkipped()` i `latestFinished()` z retencją 90 dni i mailem przy `failed` i `partial`,
- schedulery, w których start jest nadal awaitowany albo w tle, jak przed zmianą,
- `/health` z polem `jobs`: 200 przy działającej bazie, 503 bez `jobs` przy błędzie bazy,
- `installFatalHandlers` przed `NestFactory.create`,
- `decide()` z progiem 3 porażek i przypomnieniem co 12 h,
- CLI z limitem 5 s i atomowym zapisem stanu,
- `watchdog.sh` i dokumentacja.

Jedyna różnica jest świadoma i zapisana w Notes `change.md`: gdy baza działa, a odczyt `job_run` się nie uda, `/health` zwraca 200 bez `jobs`.

Scope Discipline PASS: `.run.lock`, przejęcie blokady i `timeout 240` wykraczają poza kontrakt `watchdog.sh`, ale poprawiają ustalenia poprzednich przeglądów i są opisane. `dev-local/watchdog-trial.mjs`, `run-watchdog.ts` i `watchdog-mail.ts` służą planowanym zmianom.

Safety & Quality PASS: poprawka z `9d5c457` jest poprawna:

- `shellcheck` przechodzi czysto,
- `/usr/bin/timeout` jest w bazie FreeBSD od 10.3 i zwraca 124 po upływie limitu,
- CLI nie przechwytuje SIGTERM, więc limit naprawdę kończy proces,
- 240 s to wyraźnie mniej niż próg 15 minut, po którym blokada uchodzi za osieroconą,
- `( … ) || STATUS=$?` wyłącza `set -e` w podpowłoce, ale `. ./.env` jako specjalny builtin nadal przerywa ją przy braku pliku, a sam plik jest sprawdzany wcześniej.

`dev-local/watchdog-trial.mjs` woła `dist/cli/watchdog.js` bezpośrednio, więc zmiana go nie dotyczy. Zostają dwie drobne uwagi (F1, F2).

Success Criteria — polecenia uruchomione w tym przebiegu CI:

| Polecenie (`backend-subtracker/`)                                    | Wynik                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm test`                                                           | ✅ exit 0 — 42 pliki, 572 testy                                                            |
| `npm run test:e2e`                                                   | ✅ exit 0 — 23 pliki, 199 testów                                                           |
| `npx vitest run src/jobs src/shared/process src/health src/watchdog` | ✅ exit 0 — 8 plików, 83 testy                                                             |
| `npm run migration:show`                                             | ✅ exit 0 — `[X] JobRun1795371489074` zastosowana                                          |
| `npm run lint`                                                       | ✅ exit 0 — ostrzeżenia `unbound-method` tylko w istniejących, niezmienionych plikach spec |
| `npm run build`                                                      | ✅ exit 0 — `dist/cli/watchdog.js` w buildzie                                              |
| `shellcheck --shell=sh -S warning deploy/mydevil/*.sh`               | ✅ exit 0 — czysto                                                                         |

Celowe uszkodzenia potwierdzone, każde cofnięte:

- `JOB_STALE_AFTER_HOURS` 26→27 daje 2 czerwone testy,
- `FAILURES_BEFORE_ALERT` 3→4 daje 4 czerwone testy,
- `REMIND_EVERY_HOURS` 12→13 daje 2 czerwone testy (zob. F3).

Browser e2e (`npm run build:e2e && npm run e2e`) nie jest uruchamiany w tym środowisku. Pokrywa go wymagany check `browser-e2e` w `ci.yml` na tym PR.

Ręczne kontrole: 1.7, 2.6 i 3.5 są odhaczone i mają pokrycie w kodzie. Faza 4 (4.1–4.5) czeka na człowieka i produkcję, to stan oczekujący, a nie porażka:

- 4.1: CI zielone,
- 4.2: `/health` z `jobs` na serwerze,
- 4.3: wgranie `watchdog.sh` i wpis w crontabie,
- 4.4: mail przy zatrzymanym API i mail o powrocie,
- 4.5: deploy bez fałszywego alarmu.

Ustaleń, które autor świadomie zostawił w poprzednich przeglądach, tu nie powtarzam:

- trzy zapytania w `latestFinished()`,
- nazwy zadań w publicznym `/health`,
- martwa gałąź `skipped`,
- warstwa I/O watchdoga bez testów,
- testy `recordSkipped`, przeniesione do S-16.

## Findings

### F1 — Limit 240 s może przerwać przebieg po wysłanym mailu, przed zapisem stanu

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/watchdog.sh:109
- **Detail**: `runWatchdog` wysyła maile po kolei i zapisuje stan jeden raz, na końcu (`backend-subtracker/src/watchdog/run-watchdog.ts:208`). Każdy etap wysyłki ma osobny limit 30 s (`connectionTimeout`, `greetingTimeout` i `socketTimeout` w `mail.transport.ts:35-37`). Przy wolnym, ale działającym SMTP i dwóch–trzech celach z akcją przebieg może przekroczyć nowy limit `timeout 240`. Gdy `timeout` zabije proces po wysłaniu maila, a przed `writeState`, mail nie trafi do stanu i następny przebieg wyśle go ponownie. Skutek to duplikat alarmu, a nie cisza, więc ryzyko jest niewielkie.
- **Fix**: Zapisywać stan po każdym udanym mailu (`writeState` w pętli) albo opisać w komentarzu, ile wysyłek mieści się w 240 s.
- **Decision**: PENDING

### F2 — Przejęcie osieroconej `.run.lock` nie jest atomowe

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/watchdog.sh:87
- **Detail**: Weźmy dwa przebiegi, A i B, które oba widzą starą blokadę. A robi `rmdir && mkdir`, a B robi `rmdir` dopiero po nim. Wtedy B usuwa świeżą blokadę A i zakłada własną, więc oba działają na tym samym `state.json`. Wymaga to dwóch wywołań w tej samej chwili przy już osieroconej blokadzie (np. cron i ręczne uruchomienie), więc w praktyce prawie nieosiągalne.
- **Fix**: Przejmować przez atomowe `mv "$RUN_LOCK" "$RUN_LOCK.stale.$$" && rmdir "$RUN_LOCK.stale.$$"`, a potem `mkdir`; zwycięża tylko jeden `rename`. Pozostawienie jak jest też jest rozsądne.
- **Decision**: PENDING

### F3 — Testy granicy 12 h liczą czas z samej stałej `REMIND_EVERY_HOURS`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/watchdog/watchdog-policy.spec.ts:78
- **Detail**: Testy „stays quiet … less than 12 h” i „reminds once 12 h have passed” wyliczają czas jako `REMIND_EVERY_HOURS * HOUR_MS`, więc idą za zmienioną stałą i same nie czerwienieją. Zmianę 12→13 łapie tylko test przypinający stałą (`toBe(12)`) i jeden test `keepUnsent`. Kryterium planu („celowe uszkodzenie progu 12 h czerwieni test”) jest spełnione, ale słabiej, niż sugerują nazwy testów.
- **Fix**: Zapisać granice w testach literałem (`12 * HOUR_MS`, `12 * HOUR_MS - 1`) zamiast stałej.
- **Decision**: PENDING

<!-- End of report -->
