<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Alarm o padnięciu API i zadań cyklicznych (S-11)

- **Plan**: `context/changes/operator-liveness-alerts/plan.md`
- **Scope**: Full plan (CI review on PR #62)
- **Date**: 2026-11-23
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45133279995
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

To siódmy przegląd CI tego PR. Od poprzedniego (run 45131018718, commit `d08be22`) doszedł jeden commit, `d344328`, z poprawkami F1–F5 szóstego przeglądu. Wszystkie pięć poprawek sprawdziłem w kodzie i w testach:

- **F1:** `keepUnsent` zachowuje licznik porażek przy nieudanym mailu o powrocie.
- **F2:** odpowiedź 503 z `db: error` daje mail „API bez bazy danych”.
- **F3:** linia podsumowania przebiegu podaje dzień w `APP_TIME_ZONE`.
- **F4:** odczyt `PORT` usuwa oba rodzaje cudzysłowów i białe znaki.
- **F5:** `CLAUDE.md` nie twierdzi już, że błąd przebiegu startowego jest tylko logowany.

Plan Adherence PASS: wszystkie 20 planowanych zmian z faz 1–4 jest zgodnych z planem (MATCH), bez odstępstw (DRIFT) i braków (MISSING). `d344328` nie zmienia reguł `decide()`: alarm po 3 porażkach, przypomnienie co 12 h i zerowanie stanu po powrocie zostają bez zmian. Kontrakt `/health` też jest nietknięty. Nowy temat maila mieści się w „temat np.” z planu, a dzień w linii logu tylko uzupełnia pola wymagane przez plan. Wszystkie pozycje z „What We're NOT Doing” są uszanowane.

Scope Discipline PASS: jedyny nowy dodatek spoza listy plików planu to jednowierszowa zmiana odczytu `PORT` w `deploy.sh` i `rollback.sh`. Wprowadzono ją na wniosek F4 poprzedniego przeglądu („w obu skryptach naraz”), żeby trzy skrypty czytały port tak samo. Dodatki z wcześniejszych rund pozostają uzasadnione, jak opisano w poprzednich raportach:

- `run-watchdog.ts` i `watchdog-mail.ts`,
- `dev-local/watchdog-trial.mjs`,
- `.run.lock` i `timeout 240` w `watchdog.sh`,
- wpisy w `roadmap.md`.

Safety & Quality PASS: brak problemów krytycznych i ostrzeżeń.

- Linia przyczyny w mailu o bazie to stały tekst, a HTML nadal przechodzi przez `escapeHtml`.
- `databaseDown` jest ustawiane tylko dla niezdrowego `api`.
- `tr -d "\"' \t\r"` jest poprawne w POSIX `sh` i we FreeBSD `tr`. Sprawdzone ręcznie: `PORT='3000' \t\r` daje `3000`.
- Zasady projektu są zachowane: bez `any`, importy z `.js`, `shared/` zostaje liściem.

Success Criteria — polecenia uruchomione w tym przebiegu CI:

| Polecenie                                                            | Wynik                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm test`                                                           | ✅ exit 0 — 42 pliki, 580 testów                                                           |
| `npm run test:e2e`                                                   | ✅ exit 0 — 23 pliki, 199 testów                                                           |
| `npx vitest run src/jobs src/shared/process src/health src/watchdog` | ✅ exit 0 — 8 plików, 91 testów                                                            |
| `npm run migration:show`                                             | ✅ exit 0 — `[X] JobRun1795371489074` zastosowana                                          |
| `npm run lint`                                                       | ✅ exit 0 — ostrzeżenia `unbound-method` tylko w istniejących, niezmienionych plikach spec |
| `npm run build`                                                      | ✅ exit 0 — `dist/cli/watchdog.js` w buildzie                                              |
| `shellcheck --shell=sh -S warning deploy/mydevil/*.sh`               | ✅ exit 0 — czysto                                                                         |

Celowe uszkodzenia potwierdzone w tym przebiegu, każde cofnięte:

| Uszkodzenie                                   | Czerwone testy |
| --------------------------------------------- | -------------- |
| `JOB_STALE_AFTER_HOURS` 26→27                 | 2              |
| `FAILURES_BEFORE_ALERT` 3→4                   | 11             |
| `REMIND_EVERY_HOURS` 12→13                    | 2              |
| `keepUnsent` z samym `decision.next.failures` | 3              |
| `databaseDown` nigdy nieustawiane             | 1              |
| linia podsumowania bez dnia                   | 5              |

Browser e2e (`npm run build:e2e && npm run e2e`) nie jest uruchamiany w tym środowisku. Pokrywa go wymagany check `browser-e2e` w `ci.yml` na tym PR.

Ręczne kontrole 1.7, 2.6 i 3.5 są odhaczone i mają pokrycie w kodzie. Faza 4 (4.1–4.5) czeka na człowieka i produkcję:

- 4.1: CI zielone na PR,
- 4.2: `/health` z `jobs` po deployu,
- 4.3: wgranie `watchdog.sh` (oraz, po F4, nowych `deploy.sh` i `rollback.sh`) i wpis w crontabie,
- 4.4: mail przy zatrzymanym API i mail o powrocie,
- 4.5: deploy bez fałszywego alarmu.

To stan oczekujący, a nie porażka.

Ustaleń, które autor świadomie zostawił albo przeniósł w poprzednich przeglądach (S-14/S-16), tu nie powtarzam.

## Findings

### F1 — `deploy.sh` i `rollback.sh` czytają `PORT` bez `tail -n 1`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/deploy.sh:57
- **Detail**: Po F4 trzy skrypty filtrują wartość `PORT` tak samo, ale tylko `watchdog.sh:45` bierze ostatni wiersz (`tail -n 1`). Skutki dla `.env` z dwoma wierszami `PORT=`:
  - w `deploy.sh:57` i `rollback.sh:41` port ma dwa wiersze (sprawdzone: `3001\n4000`), więc URL dla `curl` jest zły, health-check pada i deploy się cofa;
  - watchdog w tym czasie bierze ostatnią wartość, więc skrypty rozumieją port inaczej.

  Problem istniał przed `d344328` i wymaga błędnego `.env`.

- **Fix**: Dopisać `| tail -n 1` w obu skryptach (jak w `port_of` watchdoga) albo zostawić jak jest.
- **Decision**: PENDING

### F2 — Temat maila o API zależy tylko od bieżącego sprawdzenia

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/watchdog/run-watchdog.ts:153
- **Detail**: `databaseDown` nie jest zapisywane w stanie, więc temat maila opisuje tylko trzecie (albo przypominające) sprawdzenie. Przykład: dwa sprawdzenia bez odpowiedzi, a trzecie z 503 `db: error`, dają mail „API bez bazy danych”. Kolejne przypomnienia mogą zmieniać temat razem z przyczyną. Licznik porażek i czas ich początku są poprawne, więc alarm przychodzi na czas, a mylić może co najwyżej temat.
- **Fix**: Zostawić jak jest (temat opisuje stan w chwili maila) albo dopisać jedno zdanie o tym w README.
- **Decision**: PENDING

### F3 — Odczyt `PORT` w skryptach `sh` bez testu automatycznego

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: deploy/mydevil/watchdog.sh:45
- **Detail**: Zmieniony w F4 potok `sed | tr` w `watchdog.sh`, `deploy.sh` i `rollback.sh` sprawdza tylko `shellcheck` w jobie `deploy-scripts`. Ręczna próba w tym przebiegu dała poprawne wyniki. Regresja wyszłaby jednak dopiero na serwerze, przy deployu albo przy watchdogu. Plan nie wymaga testów skryptów `sh`, więc to nie jest brak względem planu.
- **Fix**: Zostawić jak jest albo przy F1 wydzielić wspólny `port_of` i sprawdzić go jednym wywołaniem w jobie `deploy-scripts`.
- **Decision**: PENDING

<!-- End of report -->
