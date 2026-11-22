<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Alarm o padnięciu API i zadań cyklicznych (S-11)

- **Plan**: `context/changes/operator-liveness-alerts/plan.md`
- **Scope**: Full plan (CI review on PR #62)
- **Date**: 2026-11-22
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45068612253
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Test Coverage       | WARNING |
| Success Criteria    | PASS    |

Plan Adherence WARNING: jedna drobna, udokumentowana rozbieżność (F2). Wszystkie pozostałe kontrakty faz 1–4 zgodne: encja i migracja `job_run` z indeksem `(job, started_at)`, `track()` / `recordSkipped()` / `latestFinished()`, mail `jobRunAlert` bez treści błędu i danych użytkowników, schedulery z zachowaną różnicą startu awaitowanego i w tle, `/health` z polem `jobs` (200 przy działającej bazie, 503 bez `jobs` przy błędzie bazy), `installFatalHandlers` przed `NestFactory.create`, `decide()` z progiem 3 i przypomnieniem co 12 h, CLI z limitem 5 s i atomowym zapisem stanu, `watchdog.sh` z ciszą przy `.ops.lock` młodszym niż 30 min, dokumentacja (`backend-patterns.md`, README PL i EN, `CLAUDE.md`, `.env.example` tylko z komentarzem).

Scope Discipline PASS: dodatki poza listą plików planu są nieszkodliwe i służą planowanym zmianom — rozbicie CLI na testowalne `watchdog/run-watchdog.ts` i `watchdog/watchdog-mail.ts` (CLI zostało czystą warstwą I/O), `firstFailureAt` i `keepUnsent()` w `watchdog-policy.ts` (potrzebne do „czasu pierwszej porażki” i reguły „nieudany mail nie zmienia stanu”), podpięcie `JobsModule` w `app.module.ts`, `auth.module.ts`, `subscriptions.module.ts`, lokalna próba `dev-local/watchdog-trial.mjs` (z `assertLocalDev()`, bez sekretów, katalog stanu w `.gitignore`), status S-11 w `roadmap.md`. Żadna granica z „What We're NOT Doing” nie została przekroczona.

Success Criteria — polecenia uruchomione w tym przebiegu CI:

| Polecenie (`backend-subtracker/`)                                    | Wynik                                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm test`                                                           | ✅ exit 0 — 42 pliki, 572 testy                                                               |
| `npm run test:e2e`                                                   | ✅ exit 0 — 23 pliki, 198 testów                                                              |
| `npx vitest run src/jobs src/shared/process src/health src/watchdog` | ✅ exit 0 — 8 plików, 83 testy                                                                |
| `npm run migration:show`                                             | ✅ exit 0 — `[X] JobRun1795371489074` zastosowana                                             |
| `npm run lint`                                                       | ✅ exit 0 — ostrzeżenia `unbound-method` tylko w istniejących, niezmienionych plikach spec    |
| `npm run build`                                                      | ✅ exit 0 — `dist/cli/watchdog.js` w buildzie (paczka `prepare-mydevil` kopiuje cały `dist/`) |
| `shellcheck --shell=sh -S warning deploy/mydevil/*.sh`               | ✅ exit 0 — czysto                                                                            |

Celowe uszkodzenia potwierdzone: `track` zapisujący zawsze `success` czerwieni 2 testy (`job-run.service.spec.ts:120`, `:143`); `failures > FAILURES_BEFORE_ALERT` zamiast `>=` czerwieni 7 testów. Browser e2e (`npm run build:e2e && npm run e2e`) nie jest uruchamiany w tym środowisku — pokrywa go wymagany check `browser-e2e` w `ci.yml` na tym PR. Uwaga środowiskowa: na runnerze powłoka eksportuje pusty `MODE`, który przesłania `MODE=DEV` z `.env` (`process.loadEnvFile` nie nadpisuje ustawionych zmiennych); e2e i `migration:show` przeszły po `unset MODE` — to nie błąd kodu.

Ręczne kontrole: 1.7, 2.6 i 3.5 są odhaczone przez autora i mają pokrycie w kodzie (podsumowania w `track`, pole `jobs` w `/health`, `dev-local/watchdog-trial.mjs`). Faza 4 (4.1–4.5: CI zielone na PR, `/health` z `jobs` na serwerze, wgranie `watchdog.sh` i wpis w crontabie, mail przy zatrzymanym API i o powrocie, deploy bez fałszywego alarmu) czeka na człowieka i produkcję — to stan oczekujący, nie porażka.

## Findings

### F1 — Mapowanie `usersFailed > 0` → `partial` w schedulerze przypomnień bez testu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/subscriptions/trial-reminder.scheduler.ts:74
- **Detail**: Plan (faza 1, §3): „W przypomnieniach `partial = usersFailed > 0` (J4)”. Linia `return { counters: { ...result }, partial: result.usersFailed > 0 };` nie jest sprawdzana przez żaden test: `test/subscriptions/trial-reminder.e2e-spec.ts` woła serwis bezpośrednio, a `job-run.service.spec.ts:120` podaje `partial: true` do `track` ręcznie. Usunięcie tego wyrażenia zostawiłoby wszystkie testy zielone, a częściowo nieudany przebieg przypomnień przestałby alarmować operatora — dokładnie ustalenie J4, które ten slice zamyka.
- **Fix**: W e2e przypomnień, z wymuszonym błędem wysyłki dla jednego użytkownika (`failMailTo`), wywołać `TrialReminderScheduler.daily()` i sprawdzić wiersz `job_run` z `outcome = 'partial'` oraz jeden wiersz `mail` typu `OPERATOR_ALERT`.
- **Decision**: PENDING

### F2 — Cel `jobs` watchdoga liczy też nieczytelne pole `jobs` jako porażkę

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: backend-subtracker/src/watchdog/run-watchdog.ts:110
- **Detail**: Plan (faza 3, §1): „Dla `jobs` „porażka” = dowolne zadanie `stale`. Tylko `stale`, bo `failed` mailuje już API.” Implementacja dodaje drugi rodzaj porażki, `{ kind: 'unreadable' }`, gdy `/health` odpowiada 200 bez poprawnego pola `jobs` (osobny temat maila w `watchdog-mail.ts`). Wynika to z równie nieplanowanej gałęzi w `health.controller.ts:46` — przy błędzie odczytu `job_run` przy działającej bazie `/health` zwraca 200 bez `jobs`. Zachowanie jest sensowne (bez niego watchdog milczałby, gdy rejestr jest nieczytelny), `failed` nadal nie jest alarmowany, a README (PL i EN) i `backend-patterns.md` to opisują; brakuje tylko zapisu decyzji w planie.
- **Fix**: Dopisać decyzję („`/health` bez `jobs` przy błędzie odczytu rejestru; watchdog traktuje to jako porażkę celu `jobs`”) do Notes w `change.md` albo do planu przed archiwizacją.
- **Decision**: PENDING

### F3 — Brak blokady przed dwoma równoczesnymi przebiegami watchdoga

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/watchdog.sh:69
- **Detail**: Skrypt sprawdza blokady deployu, ale sam żadnej nie bierze. Przy zawieszonym SMTP jeden mail może trwać ok. 90 s (limity 30 s połączenia, powitania i gniazda w `mail.transport.ts`), a przebieg wysyła do trzech maili po kolei. Skrajnie przebieg może nachodzić na kolejny z crona (co 5 min): oba czytają ten sam `state.json`, mogą wysłać ten sam alarm dwa razy, a wygrywa ostatni zapis.
- **Fix**: Przed uruchomieniem node wziąć `mkdir "$STATE_DIR/.run.lock"` z `trap 'rmdir …' EXIT` (wzór `.ops.lock`) i wyjść kodem 0, gdy blokada jest zajęta.
- **Decision**: PENDING

### F4 — `latestFinished()` wykonuje trzy kolejne zapytania na każde publiczne `/health`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/jobs/job-run.service.ts:129
- **Detail**: Pętla po `JOB_NAMES` robi po jednym `findOne` na zadanie, sekwencyjnie, obok `SELECT 1`. Endpoint jest publiczny i bez cache, więc każdy zewnętrzny wywołujący generuje cztery zapytania. Przy obecnej skali (kilkaset wierszy, indeks `(job, started_at)`) bez znaczenia.
- **Fix**: Opcjonalnie jedno zapytanie `SELECT DISTINCT ON (job) … WHERE outcome IN (…) ORDER BY job, started_at DESC` albo krótki cache w pamięci.
- **Decision**: PENDING

### F5 — Publiczne `/health` ujawnia nazwy wewnętrznych zadań i ich stan

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/health/health.controller.ts:47
- **Detail**: Każdy widzi trzy nazwy zadań i `ok | stale | failed`. Plan świadomie wybrał „obiekt per zadanie, bez liczników i dat, bo endpoint jest publiczny”, więc to zgodne z planem; ryzyko niskie. Odnotowane jako punkt do ewentualnej decyzji przy S-14 (wersja w `/health`).
- **Fix**: Zostawić; ewentualnie zwracać `jobs` tylko wywołującym z loopback, skoro watchdog pyta `localhost`.
- **Decision**: PENDING

### F6 — Martwa gałąź `skipped` w `jobHealth`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/jobs/job-health.ts:25
- **Detail**: `latestFinished()` już odfiltrowuje `skipped`, więc `run.outcome === 'skipped'` nigdy nie jest prawdą w działającym kodzie; typ `LatestJobRun.outcome` jako pełne `JobOutcome` to ukrywa. Komentarz w pliku opisuje gałąź jako zamierzoną ochronę, test `job-health.spec.ts:115` ją sprawdza.
- **Fix**: Zawęzić `LatestJobRun.outcome` do `Exclude<JobOutcome, 'skipped'>` i usunąć gałąź, albo zostawić jako jawny guard.
- **Decision**: PENDING

### F7 — Strażnik „poprzedni przebieg trwa” w trzech schedulerach bez testu

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/subscriptions/trial-reminder.scheduler.ts:65
- **Detail**: Wywołania `recordSkipped` przy podniesionej fladze `running` (`subscription-lifecycle.scheduler.ts:40`, `auth-cleanup.scheduler.ts:40`, `trial-reminder.scheduler.ts:65`) nie są pokryte; testy ma tylko `JobRunService.recordSkipped`. Najważniejszy jest wariant przypomnień, bo łączy się z `currentRun` i `idle()`.
- **Fix**: Jeden test na scheduler: pierwszy przebieg trzymany otwarty, drugi zostawia wiersz `skipped`.
- **Decision**: PENDING

### F8 — Warstwa I/O watchdoga (`cli/watchdog.ts`, `watchdog.sh`) sprawdzana tylko ręcznie i statycznie

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/cli/watchdog.ts
- **Detail**: Bez testów: kod wyjścia 1 przy złym env, `readState` przy braku/uszkodzonym pliku, atomowy `writeState`, limit 5 s w `get()`. `watchdog.sh` ma tylko shellcheck (cisza przy blokadzie < 30 min, log starej blokady, brak `PORT`). Logika, którą to steruje, jest dobrze pokryta (`run-watchdog.spec.ts`, w tym `parseWatchdogState`), a plan przewidział dla tej warstwy próbę ręczną (3.5) i kontrole produkcyjne (4.3–4.5) — zgodne ze wzorcem pozostałych skryptów MyDevil.
- **Fix**: Przy ręcznych kontrolach 4.3–4.5 sprawdzić też ciszę przy świeżym `.ops.lock`; opcjonalnie wydzielić `readState`/`writeState` i przetestować na katalogu tymczasowym.
- **Decision**: PENDING

<!-- End of report -->
