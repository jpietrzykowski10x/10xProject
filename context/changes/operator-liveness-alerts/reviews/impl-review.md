<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Alarm o padnięciu API i zadań cyklicznych (S-11)

- **Plan**: `context/changes/operator-liveness-alerts/plan.md`
- **Scope**: Full plan (CI review on PR #62)
- **Date**: 2026-11-22
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45075848606
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Test Coverage       | PASS    |
| Success Criteria    | PASS    |

To drugi przegląd CI tego PR. Od poprzedniego (run 45068612253, commit `1add78c`) doszły: `b3858be` (blokada `.run.lock` w `watchdog.sh` jako poprawka F3 i zapis decyzji F2 w `change.md`), `fbdafe2` (test e2e przebiegu przypomnień `partial`, poprawka F1), `a32525f` (notatka w `change.md`) i merge `origin/main`.

Plan Adherence PASS: wszystkie kontrakty faz 1–4 zgodne — encja i migracja `job_run` z indeksem `(job, started_at)`, `track()` / `recordSkipped()` / `latestFinished()` z retencją 90 dni i mailem przy `failed`/`partial`, schedulery z zachowaną różnicą startu awaitowanego i w tle, `/health` z polem `jobs` (200 przy działającej bazie, 503 bez `jobs` przy błędzie bazy), `installFatalHandlers` przed `NestFactory.create`, `decide()` z progiem 3 i przypomnieniem co 12 h, CLI z limitem 5 s i atomowym zapisem stanu, `watchdog.sh`, dokumentacja. Poprzednie F2 (brak albo nieczytelne `jobs` jako porażka celu `jobs`) jest teraz zapisane jako decyzja w Notes `change.md`, README i `backend-patterns.md`, więc nie jest już rozbieżnością.

Scope Discipline PASS: dodatki poza listą plików planu są nieszkodliwe i służą planowanym zmianom (`watchdog/run-watchdog.ts`, `watchdog/watchdog-mail.ts`, podpięcie `JobsModule`, `dev-local/watchdog-trial.mjs`, status S-11 w `roadmap.md`). `CLAUDE.md` dostał kilka zdań zamiast jednego, ale treść zgadza się z kodem.

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

Celowe uszkodzenia potwierdzone (każde cofnięte): `JOB_STALE_AFTER_HOURS` 26→27 czerwieni 2 testy `job-health.spec.ts`; `REMIND_EVERY_HOURS` 12→13 czerwieni 2 testy `watchdog-policy.spec.ts`; `FAILURES_BEFORE_ALERT` 3→4 czerwieni 8 testów; `partial: false` w `trial-reminder.scheduler.ts` czerwieni nowy test w `test/jobs/job-run.e2e-spec.ts` (poprzednie F1 naprawione). Browser e2e (`npm run build:e2e && npm run e2e`) nie jest uruchamiany w tym środowisku — pokrywa go wymagany check `browser-e2e` w `ci.yml` na tym PR.

Ręczne kontrole: 1.7, 2.6 i 3.5 są odhaczone i mają pokrycie w kodzie. Faza 4 (4.1–4.5: CI zielone, `/health` z `jobs` na serwerze, wgranie `watchdog.sh` i wpis w crontabie, mail przy zatrzymanym API i o powrocie, deploy bez fałszywego alarmu) czeka na człowieka i produkcję — to stan oczekujący, nie porażka.

Ustalenia z poprzedniego przeglądu, które autor świadomie zostawił (F4 trzy zapytania w `latestFinished()`, F5 nazwy zadań w publicznym `/health`, F6 martwa gałąź `skipped`, F8 warstwa I/O watchdoga bez testów), nie są tu powtarzane; F7 (brak testu ścieżki `skipped` schedulerów) wraca jako F3, bo nadal jest aktualne.

## Findings

### F1 — Osierocona blokada `.run.lock` na stałe ucisza watchdoga

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/watchdog.sh:71
- **Detail**: Nowa blokada (poprawka poprzedniego F3) to samo `mkdir "$STATE_DIR/.run.lock"`, zwalniane tylko przez `trap 'rmdir …' EXIT`. SIGKILL (OOM, sprzątanie procesów MyDevil) albo restart serwera w trakcie przebiegu pomija trap, a katalog `~/apps/subtracker/watchdog/` przeżywa deploye i restarty. Od tej chwili każdy przebieg z crona loguje „the previous watchdog run is still going; skipped” i kończy się kodem 0 — watchdog milczy bez żadnego maila, choć to on ma wykrywać ciche awarie. Ten sam skrypt traktuje `.ops.lock` odwrotnie (linie 32–40: blokada starsza niż 30 min nie ucisza), zgodnie z zasadą z planu: „blokada osierocona przez zabity proces nie może go uciszyć na zawsze”. Dodatkowo każdy błąd `mkdir` (brak uprawnień, pełny dysk) jest raportowany jako „poprzedni przebieg trwa”, a `prune-backups.sh:42-48` odróżnia te przypadki przez `[ -d "$LOCK" ]`. README (PL `:215`, EN `:472`) w ogóle nie wspomina `.run.lock`, więc operator nie wie, że trzeba go usunąć.
- **Fix A ⭐ Recommended**: Przy zajętej blokadzie sprawdzić jej wiek jak przy `.ops.lock` (`find "$RUN_LOCK" -maxdepth 0 -mmin +15`): starsza — zapisać w logu i przejąć (`rmdir && mkdir`), młodsza — pominąć jak teraz; gdy katalog nie istnieje mimo błędu `mkdir`, `exit 1`. Dopisać `.run.lock` do README (PL i EN).
  - Strength: Ten sam wzorzec co `.ops.lock` w tym pliku i `prune-backups.sh`; zwykły przebieg trwa sekundy (fetch 5 s, SMTP 30 s limitów), więc 15 min to bezpieczny margines.
  - Tradeoff: Przejęcie blokady żywego, ale zawieszonego procesu może dać dwa nakładające się przebiegi — warto połączyć z limitem czasu node (F2).
  - Confidence: HIGH — mechanizm i próg już istnieją w tym samym skrypcie.
  - Blind spot: Nie sprawdzono, czy MyDevil faktycznie zabija procesy z crona sygnałem KILL.
- **Fix B**: Zamiast katalogu użyć blokady jądra zwalnianej przy każdej śmierci procesu (`lockf -t 0` na FreeBSD, `flock -n` na Linuksie przy lokalnej próbie).
  - Strength: Brak stanu na dysku, więc nie ma czego osierocić.
  - Tradeoff: Inne narzędzie na serwerze i lokalnie; odbiega od wzorca `mkdir` w pozostałych skryptach.
  - Confidence: MEDIUM — dostępność `lockf` na hoście MyDevil niezweryfikowana.
  - Blind spot: Zachowanie `shellcheck --shell=sh` i lokalnej próby na Windows/Linux.
- **Decision**: PENDING

### F2 — Brak całkowitego limitu czasu przebiegu `node cli/watchdog.js`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/watchdog.sh:90
- **Detail**: `socketTimeout` nodemailera to limit bezczynności, więc serwer SMTP, który sączy bajty, może trzymać proces (i blokadę) bardzo długo. Przy przejęciu blokady po wieku (F1, Fix A) żywy przebieg mógłby nachodzić na nowy na tym samym `state.json`.
- **Fix**: Ograniczyć przebieg, np. `timeout 240 "$NODE" cli/watchdog.js` (bez `exec`, żeby trap zwolnił blokadę), z progiem przejęcia blokady wyższym niż ten limit.
- **Decision**: PENDING

### F3 — Ścieżka „poprzedni przebieg trwa” (`recordSkipped`) w trzech schedulerach bez testu

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/subscriptions/trial-reminder.scheduler.ts:65
- **Detail**: Nadal aktualne z poprzedniego przeglądu (F7). Gałęzie z podniesioną flagą `running` (`subscription-lifecycle.scheduler.ts:38-41`, `auth-cleanup.scheduler.ts:38-41`, `trial-reminder.scheduler.ts:59-66`) nie są pokryte; testowany jest tylko `JobRunService.recordSkipped`. Wariant przypomnień jest najważniejszy, bo zwraca obietnicę trwającego przebiegu, na której polega `idle()` i `start()` helpera e2e.
- **Fix**: Jeden test na scheduler: pierwszy przebieg trzymany otwarty, drugi zostawia wiersz `skipped` (dla przypomnień także: drugie wywołanie rozwiązuje się dopiero po pierwszym).
- **Decision**: PENDING

<!-- End of report -->
