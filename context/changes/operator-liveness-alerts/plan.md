# Alarm o padnięciu API i zadań cyklicznych — plan implementacji

## Overview

Operator (właściciel, jedyna osoba utrzymująca produkcję) ma się dowiadywać o awarii z maila, a nie od użytkownika. Każdy przebieg trzech zadań cyklicznych (cykl życia subskrypcji, sprzątanie auth, przypomnienia o trialu) zostawia trwały wiersz, a API wysyła mail przy każdym nieudanym albo częściowo nieudanym przebiegu. `/health` zgłasza stan zadań. Zewnętrzny watchdog z crona co 5 minut sprawdza API i frontend. Po 3 kolejnych porażkach mailuje, przy dalszej awarii przypomina co 12 h, a po powrocie wysyła jeden mail. Pilnuje też, czy zadanie nie stoi od 26 h. Realizuje PRD v2 FR-019 i roadmapę S-11 oraz zamyka ustalenia audytu P1, J1, J2 i J4, a częściowo J3.

## Current State Analysis

- Trzy schedulery mają ten sam wzorzec (`backend-patterns.md`, „Wzorzec schedulera”): `onApplicationBootstrap` + `@Cron`, flaga `running`, `try/catch` z samym `error.message` w logu:
  - `subscriptions/subscription-lifecycle.scheduler.ts:13-57` (00:05, start awaitowany),
  - `auth/auth-cleanup.scheduler.ts:11-48` (00:05, start awaitowany),
  - `subscriptions/trial-reminder.scheduler.ts:22-101` (02:00, start w tle, `idle()` dla e2e).
- Logują wyłącznie wtedy, gdy coś zmieniły (J2). Mail do operatora wysyła tylko przypomnienie o trialu, i to tylko przy błędzie całego przebiegu (`trial-reminder.scheduler.ts:88-99`). `usersFailed > 0` daje sam `warn` (J4), a błąd cyklu życia i sprzątania kończy się jedną linią w `err.log` (J1).
- Nie ma żadnego zapisu, że przebieg się odbył. Job, który nie ruszył, wygląda jak dzień bez pracy.
- `health/health.controller.ts:17-37`: `@Public() GET /health` robi tylko `SELECT 1` i zwraca 503 przy błędzie bazy. Woła go wyłącznie `deploy.sh:60` (`curl localhost:$port/health`), który przy porażce cofa deploy i przywraca bazę z dumpu.
- `main.ts` nie ma `process.on('uncaughtException' | 'unhandledRejection')` (P1). `forever` restartuje proces po wyjściu (`deploy/mydevil/start-app.sh:31-43`), a pętla restartów jest dla operatora niewidoczna.
- Alarm operatora: `MailService.notifyOperator(content)` (`mail/services/mail.service.ts:96`) wysyła kanałem `operator` (transport `NOTIFICATION_SMTP_*`, bez nich zwykły SMTP, `mail.transport.ts:97-112`) i zapisuje wiersz audytu `mail` (wymaga bazy). Adres ma w `NOTIFICATION_ADMINISTRATOR_MAIL` (wymagany w PROD).
- Na serwerze skrypty `cli/*.js` z paczki API uruchamia `node24` z wyeksportowanym `.env` (`deploy/mydevil/README.md:139-153`). Zadania z crona: `prune-backups.sh` (wzór blokady `.ops.lock`, nadpisań ścieżek do lokalnej próby, logu do `api/logs/*.log`). CI `deploy-scripts` robi `shellcheck --shell=sh -S warning deploy/mydevil/*.sh` (`.github/workflows/ci.yml:269-272`).
- Encje ładowane są globem `**/*.entity.js` (`database/database.options.ts:62`), więc nowa encja nie wymaga rejestracji w liście.

## Desired End State

- W tabeli `job_run` jest wiersz dla każdego przebiegu każdego zadania (start i cron), z wynikiem i licznikami. Po 90 dniach wiersze znikają.
- Przebieg `failed` (wyjątek) albo `partial` (część użytkowników bez przypomnienia) wysyła mail do operatora z nazwą zadania, dniem, wynikiem i licznikami, bez danych użytkowników i bez treści błędu. Każdy przebieg kończy się jedną linią podsumowania w logu, także gdy nic nie zmienił.
- `GET /health` zwraca nadal 200 przy działającej bazie, z polem `jobs` z wartościami `ok | stale | failed` dla każdego z trzech zadań. `stale` oznacza brak zakończonego przebiegu od 26 h.
- Nieobsłużony wyjątek albo odrzucenie zostawia w `err.log` jedną bezpieczną linię i kończy proces kodem 1.
- Watchdog z crona co 5 minut sprawdza `localhost` API (`/health`) i frontendu (`/`):
  - po 3 kolejnych porażkach danego celu wysyła mail „nie działa”,
  - gdy cel dalej leży, przypomina co 12 h,
  - po powrocie wysyła jeden mail „działa ponownie”,
  - ten sam schemat stosuje do `jobs: stale` z `/health`.
- Weryfikacja: testy jednostkowe i e2e zielone. Na produkcji zatrzymane API daje mail po ~15 minutach, a po starcie przychodzi mail o powrocie.

### Key Discoveries:

- Rejestr to ogólna infrastruktura zależna od `MailService`. Nie może trafić do `shared/`, który jest liściem bez wiedzy o modułach (`lessons.md`, „Kod ogólny w `shared/`”), więc dostaje własny moduł `src/jobs/`.
- `MailService` zapisuje audyt w bazie, a watchdog musi wysłać mail właśnie wtedy, gdy API albo baza leży. Watchdog używa więc samego `createMailTransport(env)` kanałem `operator`, bez `MailService` i bez wiersza `mail`.
- Przebieg przypomnień przy starcie idzie w tle, a pozostałe dwa są awaitowane. Rejestr nie może zmienić tej różnicy: start w tle nadal nie może opóźnić health-checku deployu (`backend-patterns.md`, „Przypomnienia o trialu”).
- Deploy trzyma blokadę `~/apps/subtracker/<app>/.ops.lock` (`prune-backups.sh:43-53`). Na czas deployu watchdog milczy, ale blokada osierocona przez zabity proces nie może go uciszyć na zawsze.

## What We're NOT Doing

- Monitor dostępności z zewnątrz serwera (proxy MyDevil, DNS, TLS). Watchdog sprawdza `localhost` tak jak `deploy.sh`, więc awaria samego proxy pozostaje niewidoczna (zapisane w README jako ograniczenie).
- Osobny kanał alarmów i blokada powtórzeń per typ: S-12 (FR-020). S-11 używa istniejącego transportu operatora.
- Przyczyny porażek w rozbiciu (brak konta, SMTP, baza) i UUID użytkownika w logach jobów: S-16 (FR-024). S-11 zapisuje tylko wynik i liczniki.
- Format logu, wersja (SHA) w `/health`, access log: S-14 (FR-022). Kolory ANSI w liniach logu schedulerów zostają, poprawi je S-14.
- Sprawdzanie kolacji ICU i aktualności migracji w `/health` (S9, P9).
- Zmiana kodu odpowiedzi `/health` przy złych jobach i automatyczny rollback deployu przy nieudanym przebiegu startowym (J3 w pełni). Decyzja: 200 + pole `jobs`, bo przywrócenie dumpu kasowałoby znaczniki przypomnień.
- `enableShutdownHooks` w `main.ts` (zachowanie zatrzymania procesu się nie zmienia).
- Widok przebiegów w UI admina.

## Implementation Approach

Od środka na zewnątrz. Najpierw rejestr i alarm wewnątrz API (faza 1), bo daje sygnał przy każdej awarii zadania, gdy API żyje. Potem `/health` czyta ten rejestr, a handlery procesu zostawiają ślad padnięcia (faza 2). Na końcu zewnętrzny watchdog (faza 3). Tylko on widzi leżące API i zadanie, które nie ruszyło, więc korzysta z obu wcześniejszych faz. Logika decyzji watchdoga jest czystą funkcją stanu, testowaną jednostkowo. Wejście i wyjście (HTTP, plik stanu, SMTP) to cienka warstwa w CLI, a skrypt `sh` tylko ustawia środowisko i blokady. Faza 4 to dokumentacja, wpis w crontabie i sprawdzenie na produkcji.

## Critical Implementation Details

- **Kolejność i retencja:** wiersz `job_run` powstaje przed wywołaniem serwisu (`started_at`), a uzupełnia go `UPDATE` po końcu. Proces zabity w trakcie zostawia wiersz bez `finished_at` i bez wyniku, a `/health` liczy `stale` od ostatniego **zakończonego** przebiegu. Usuwanie wierszy starszych niż 90 dni idzie w tym samym kroku co zapis startu i nigdy nie może wywrócić przebiegu: błąd zapisu rejestru tylko trafia do logu, a samo zadanie i tak się wykonuje.
- **Mail przy porażce bez pętli:** mail o porażce zadania idzie przez `notifyOperator`, który nigdy nie odrzuca. Gdy padnie i zapis rejestru, i mail, zostaje sama linia `error` w logu. Nic nie ponawia w pętli.
- **Stan watchdoga poza wydaniem:** plik stanu leży w `~/apps/subtracker/watchdog/state.json`, nie w `public_nodejs`, więc deploy (podmiana katalogu) go nie kasuje. Zapis jest atomowy: plik tymczasowy, potem `rename`.

## Phase 1: Rejestr przebiegów i alarm z API

### Overview

Nowy moduł `jobs/` z encją `job_run` i serwisem, który owija przebieg zadania. Zapisuje start, koniec, wynik i liczniki, loguje podsumowanie i wysyła mail do operatora przy `failed` i `partial`. Trzy schedulery przechodzą na ten serwis.

### Changes Required:

#### 1. Encja i migracja

**File**: `backend-subtracker/src/jobs/entities/job-run.entity.ts`, `backend-subtracker/src/jobs/job-run.types.ts`, `backend-subtracker/src/database/migrations/<ts>-JobRun.ts`

**Intent**: Trwały ślad każdego przebiegu, z którego czytają `/health`, watchdog (przez `/health`) i później S-16.

**Contract**: tabela `job_run`:
- `id uuid` (`gen_random_uuid()`),
- `job varchar(40)` — `JobName`: `subscription-lifecycle` | `auth-cleanup` | `trial-reminder`,
- `trigger varchar(10)` — `startup` | `cron`,
- `started_at timestamptz not null`, `finished_at timestamptz null`,
- `outcome varchar(10) null` — `success` | `partial` | `failed` | `skipped`; `null`, dopóki przebieg trwa,
- `counters jsonb null` — liczby zwrócone przez serwis zadania, np. `{ "trialsActivated": 2 }`.

Indeks `(job, started_at)` pod zapytanie „ostatni zakończony przebieg zadania” i pod usuwanie starych wierszy. Typy jako unie stałych w `job-run.types.ts` (bez `any`). Migracja generowana `npm run migration:generate -- JobRun` względem `subtracker-db`, przejrzana i zastosowana `migration:run` (`lessons.md`, migracje).

#### 2. Serwis rejestru

**File**: `backend-subtracker/src/jobs/job-run.service.ts`, `backend-subtracker/src/jobs/jobs.module.ts`, `backend-subtracker/src/jobs/job-run-alert.ts`

**Intent**: Jedno miejsce, które zamienia „przebieg zadania” w wiersz, linię logu i ewentualny mail, żeby schedulery zostały cienkie i jednakowe.

**Contract**:
- `JobRunService.track(job: JobName, trigger: JobTrigger, run: () => Promise<JobRunReport>): Promise<void>`, gdzie `JobRunReport = { counters: Record<string, number>; partial?: boolean }`:
  - zapisuje start i usuwa wiersze z `started_at` starszym niż 90 dni (`JOB_RUN_RETENTION_DAYS`),
  - woła `run()` i zapisuje koniec z wynikiem: `success`, `partial` (gdy `report.partial`) albo `failed` (wyjątek),
  - zawsze loguje jedną linię podsumowania: zadanie, wyzwalacz, wynik, liczniki, czas trwania w ms; przy `failed` jako `error` z samym `error.message`, przy `partial` jako `warn`,
  - przy `failed` i `partial` woła `MailService.notifyOperator`,
  - nigdy nie odrzuca; błąd zapisu rejestru tylko loguje i nie przerywa zadania.
- `JobRunService.recordSkipped(job, trigger)` zapisuje wiersz `skipped` (start = koniec) dla przebiegu pominiętego flagą `running`.
- `JobRunService.latestFinished(): Promise<Map<JobName, { finishedAt: Date; outcome: JobOutcome }>>` dla fazy 2 (ostatni zakończony przebieg innego wyniku niż `skipped`, per zadanie).
- `job-run-alert.ts`: czysta funkcja budująca `MailContent` (temat `SubTracker: zadanie <job> — <wynik>`, treść: dzień w `APP_TIME_ZONE`, wynik, liczniki, „Szczegóły w logu API”) z `escapeHtml` w HTML. Bez treści błędu i danych użytkowników.
- `JobsModule` importuje `MailModule` i rejestruje encję. Moduły `subscriptions` i `auth` importują `JobsModule`.

#### 3. Schedulery na rejestrze

**File**: `subscriptions/subscription-lifecycle.scheduler.ts`, `auth/auth-cleanup.scheduler.ts`, `subscriptions/trial-reminder.scheduler.ts`

**Intent**: Każdy przebieg przechodzi przez `track` z właściwym wyzwalaczem, a zachowanie startu (awaitowany albo w tle) zostaje bez zmian.

**Contract**:
- `run(trigger)`: przy podniesionej fladze `running` `recordSkipped` i ostrzeżenie jak dotąd, w przeciwnym razie `track(job, trigger, …)`.
- Serwis zadania zwraca liczniki. W przypomnieniach `partial = usersFailed > 0` (J4).
- Własny `notifyOperator` w `TrialReminderScheduler` znika, bo zastępuje go `track`. Usuwa to też zależność schedulera od `MailService`.
- Usuwane są warunkowe `logger.log` „tylko gdy coś zmienił” (podsumowanie loguje teraz `track`).
- `idle()` i `beforeApplicationShutdown` w przypomnieniach zostają.

### Success Criteria:

#### Automated Verification:

- Migracja `JobRun` wygenerowana względem `subtracker-db`, przejrzana i zastosowana: `npm run migration:run` (backend)
- Testy jednostkowe `JobRunService` i `job-run-alert` (sukces, `partial`, `failed`, `skipped`, błąd zapisu rejestru nie przerywa zadania, retencja 90 dni, treść maila bez danych użytkowników): `npx vitest run src/jobs`
- Testy e2e: przebieg startowy każdego z trzech zadań zostawia wiersz `success` w `job_run`; wymuszony błąd serwisu cyklu życia daje wiersz `failed` i jeden wiersz `mail` typu `OPERATOR_ALERT`: `npm run test:e2e`
- Celowe uszkodzenie (np. `track` nie zapisuje wyniku) czerwieni co najmniej jeden test
- Lint i build: `npm run lint && npm run build` (backend)
- Wszystkie testy backendu: `npm test && npm run test:e2e`

#### Manual Verification:

- Lokalnie po `npm run start:dev` w logu są trzy linie podsumowania przebiegów startowych, a w `subtracker-db-dev` trzy wiersze `job_run`

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: `/health` z polem `jobs` i handlery procesu

### Overview

`/health` zgłasza stan zadań bez zmiany kodu odpowiedzi. `main.ts` zostawia ślad nieobsłużonego wyjątku i kończy proces.

### Changes Required:

#### 1. Stan zadań w `/health`

**File**: `backend-subtracker/src/health/health.controller.ts`, `backend-subtracker/src/jobs/job-health.ts`

**Intent**: Watchdog (faza 3) dowiaduje się z jednego żądania, czy zadanie nie stoi albo ostatnio padło. Deploy nadal patrzy tylko na bazę.

**Contract**:
- Czysta funkcja `jobHealth(latest, now): Record<JobName, 'ok' | 'stale' | 'failed'>` w `job-health.ts`:
  - `stale`, gdy zadanie nie ma zakończonego przebiegu albo ostatni zakończył się wcześniej niż `now − 26 h` (`JOB_STALE_AFTER_HOURS = 26`),
  - `failed`, gdy ostatni zakończony ma wynik `failed`,
  - w przeciwnym razie `ok` (`partial` liczy się jako `ok`, bo mail już wyszedł z API).
- `HealthStatus` rozszerzony o `jobs` (obiekt per zadanie, bez liczników i dat, bo endpoint jest publiczny).
- Przy błędzie bazy odpowiedź jak dotąd: 503 `{ status: 'error', db: 'error' }`, bez `jobs`. Przy działającej bazie zawsze 200.
- `@Public()` zostaje.

#### 2. Handlery procesu

**File**: `backend-subtracker/src/main.ts`, `backend-subtracker/src/shared/process/fatal-handlers.ts`

**Intent**: Pad procesu przestaje być cichy (P1). Linia w `err.log` mówi, co się stało, bez parametrów zapytań i danych.

**Contract**:
- `installFatalHandlers(log: (line: string) => void, exit: (code: number) => void)` w `shared/process/` (ogólne, bez wiedzy o domenie, z testem obok),
- rejestruje `uncaughtException` i `unhandledRejection`,
- loguje jedną linię `Fatal <rodzaj>: <name>: <message>` (bez `inspect`, bez obiektu błędu i bez stosu z parametrami),
- woła `exit(1)`; `forever` restartuje proces.
- `main.ts` instaluje handlery przed `NestFactory.create`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe `jobHealth` (brak przebiegu, 25 h 59 min, 26 h 1 min, `failed`, `partial`, `skipped` ignorowany) i `installFatalHandlers` (linia bez stosu, `exit(1)`): `npx vitest run src/jobs src/shared/process src/health`
- Test e2e: `GET /health` bez ciasteczka zwraca 200 z `jobs` dla wszystkich trzech zadań równym `ok` po starcie aplikacji; wiersze `job_run` postarzone o 27 h dają `stale`: `npm run test:e2e`
- Istniejące testy `/health` (deploy health-check, 503 przy błędzie bazy) zielone
- Celowe uszkodzenie progu 26 h czerwieni test
- Lint i build: `npm run lint && npm run build` (backend)

#### Manual Verification:

- Lokalnie `curl localhost:3000/health` pokazuje pole `jobs`

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Watchdog

### Overview

Skrypt z crona co 5 minut sprawdza API i frontend oraz stan zadań z `/health`. Mailuje operatorowi zgodnie z polityką: 3 kolejne porażki, przypomnienie co 12 h, jeden mail o powrocie.

### Changes Required:

#### 1. Logika decyzji

**File**: `backend-subtracker/src/watchdog/watchdog-policy.ts` (+ `.spec.ts`)

**Intent**: Cała polityka alarmu jako czysta funkcja, testowana bez sieci, plików i zegara.

**Contract**:
- `decide(state: TargetState | undefined, healthy: boolean, now: Date): { next: TargetState; action: 'none' | 'alert-down' | 'remind-down' | 'recovered' }`, gdzie `TargetState = { failures: number; alerted: boolean; lastMailAt?: string }` (ISO).
- Stałe: `FAILURES_BEFORE_ALERT = 3`, `REMIND_EVERY_HOURS = 12`.
- Reguły:
  - porażka zwiększa `failures`; przy osiągnięciu 3 i braku `alerted` wynik to `alert-down`;
  - przy `alerted` i co najmniej 12 h od `lastMailAt` wynik to `remind-down`;
  - sukces przy `alerted` daje `recovered` i zeruje stan; sukces bez `alerted` tylko zeruje `failures`.
- Cele: `api`, `frontend`, `jobs`. Dla `jobs` „porażka” = dowolne zadanie `stale`. Tylko `stale`, bo `failed` mailuje już API. Gdy API leży, cel `jobs` nie jest oceniany (stan bez zmian).

#### 2. CLI watchdoga

**File**: `backend-subtracker/src/cli/watchdog.ts`

**Intent**: Cienka warstwa wejścia i wyjścia wokół `decide`, uruchamiana na serwerze jak inne `cli/*.js`.

**Contract**:
- Env: zmienne API z `.env` (adres operatora i SMTP przez istniejące `validateEnv`/`envFromConfig`) oraz `WATCHDOG_API_PORT`, `WATCHDOG_FRONTEND_PORT`, `WATCHDOG_STATE_FILE` ustawiane przez skrypt `sh`.
- Sprawdzenie: `fetch` `http://localhost:<port>/health` i `http://localhost:<port>/` z limitem 5 s. Zdrowy = status 2xx (dla API dodatkowo poprawny JSON z `status: 'ok'`).
- Stan: odczyt i zapis JSON w `WATCHDOG_STATE_FILE`, zapis atomowy. Brak lub uszkodzony plik oznacza pusty stan.
- Mail: `createMailTransport(env)` kanałem `operator` do `NOTIFICATION_ADMINISTRATOR_MAIL`:
  - temat np. `SubTracker: API nie odpowiada` / `SubTracker: API działa ponownie` / `SubTracker: zadanie cykliczne nie ruszyło od 26 h`,
  - treść: cel, liczba porażek, czas pierwszej porażki, bez danych użytkowników,
  - bez `MailService` i bez wiersza `mail`, bo baza może nie działać.
- Gdy mail się nie uda, `lastMailAt` i `alerted` się nie zmieniają, więc kolejny przebieg spróbuje ponownie.
- Log: jedna linia tylko przy akcji innej niż `none` albo przy błędzie samego watchdoga. Kod wyjścia 0, chyba że watchdog nie może działać (zły env), wtedy 1.

#### 3. Skrypt serwera

**File**: `deploy/mydevil/watchdog.sh`

**Intent**: Uruchomienie z crona z tym samym środowiskiem co `cli/*.js` i z ciszą na czas deployu.

**Contract**:
- `set -eu`, `PATH` jak `prune-backups.sh`.
- Przebieg pomijany (kod 0, linia w logu), gdy istnieje `~/apps/subtracker/api/.ops.lock` albo `~/apps/subtracker/frontend/.ops.lock` młodszy niż 30 minut. Starsza blokada nie ucisza watchdoga: zostaje zapisana w logu.
- Porty z `api/public_nodejs/.env` i `frontend/public_nodejs/.env` (zmienna `PORT`), czytane bez wykonywania reszty pliku frontendu.
- Uruchamia `node24 cli/watchdog.js` z katalogu działającego wydania API z wyeksportowanym `.env` API.
- Nadpisania ścieżek `SUBTRACKER_*` do lokalnej próby jak w `prune-backups.sh`.
- Przechodzi `shellcheck --shell=sh -S warning`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe `decide`: 1 i 2 porażki bez maila, 3. porażka `alert-down`, kolejne porażki bez maila do 12 h, potem `remind-down`, sukces po alarmie `recovered`, sukces bez alarmu bez maila, nieudany mail nie zmienia stanu, cel `jobs` nieoceniany przy leżącym API: `npx vitest run src/watchdog`
- Celowe uszkodzenie progu 3 albo 12 h czerwieni test
- `shellcheck --shell=sh -S warning deploy/mydevil/*.sh` czysto (lokalnie `npx shellcheck`, jak w CI `deploy-scripts`)
- Lint i build: `npm run lint && npm run build` (backend); `cli/watchdog.js` jest w paczce `prepare-mydevil`

#### Manual Verification:

- Lokalna próba (`MODE=DEV`, z pustym `SMTP_HOST` mail trafia na konsolę) wywołana 3 razy przy zatrzymanym API daje dokładnie jeden mail „nie odpowiada” przy trzecim uruchomieniu, a po starcie API jeden mail „działa ponownie”

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 4.

---

## Phase 4: Dokumentacja i produkcja

### Overview

Wzorce i instrukcje serwera opisują nowy mechanizm. Watchdog trafia do crontaba, a całość jest sprawdzona na produkcji.

### Changes Required:

#### 1. Dokumenty

**File**: `context/foundation/backend-patterns.md`, `deploy/mydevil/README.md` (PL i EN), `CLAUDE.md`, `backend-subtracker/.env.example`

**Intent**: Kolejny slice i kolejna sesja wiedzą, że każdy nowy job idzie przez `JobRunService.track`, a operator wie, jak zainstalować i sprawdzić watchdoga.

**Contract**:
- `backend-patterns.md`, „Wzorzec schedulera”: `track`, wyniki, mail przy `failed`/`partial`, `/health.jobs`, retencja 90 dni. Usunięte zdania o logowaniu „tylko gdy przebieg coś zmienił”.
- README: wiersz `watchdog.sh` w tabeli skryptów, linia crontaba `*/5 * * * * …/bin/watchdog.sh >> …/api/logs/watchdog.log 2>&1`, ręczne wgranie (`scp`, `chmod 700`, `sha256`), katalog `~/apps/subtracker/watchdog/`, ograniczenie „tylko `localhost`, proxy niewidoczne”, jak wyciszyć (zakomentować linię crontaba).
- `CLAUDE.md`: zdanie w opisie jobów o `job_run`, `/health.jobs` i watchdogu.
- `.env.example`: bez nowych kluczy (porty i plik stanu ustawia skrypt). Komentarz przy `NOTIFICATION_ADMINISTRATOR_MAIL`, że odbiera też alarmy watchdoga.

### Success Criteria:

#### Automated Verification:

- Pełne testy backendu i CI zielone na PR (`backend`, `backend-e2e`, `deploy-scripts`)

#### Manual Verification:

- Po deployu API: `curl localhost:<port>/health` na serwerze pokazuje `jobs` z `ok` dla trzech zadań
- `watchdog.sh` wgrany (`scp`, `chmod 700`, zgodne `sha256`), wpis w crontabie dodany, ręczne uruchomienie kończy się kodem 0 bez maila
- Zatrzymane API (`stop-app.sh api`): mail „API nie odpowiada” w ciągu ~15 minut; po `start-app.sh api` jeden mail „API działa ponownie”
- Brak fałszywego alarmu podczas zwykłego deployu (watchdog pomija przebieg przy `.ops.lock`)

**Implementation Note**: Po wdrożeniu i ręcznych testach na produkcji zatrzymaj się na potwierdzenie przed `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `JobRunService`: zapis startu i końca, wyniki, `skipped`, retencja, błąd zapisu nie przerywa zadania, mail tylko przy `failed`/`partial`.
- `job-run-alert`: temat i treść bez danych użytkowników, `escapeHtml`.
- `jobHealth`: granice 26 h, `failed`, `partial`, brak przebiegu.
- `installFatalHandlers`: jedna linia bez stosu, `exit(1)`.
- `decide`: pełna tabela przejść z progiem 3 i przypomnieniem 12 h.

### Integration Tests:

- e2e: przebiegi startowe trzech zadań zapisują `success`; wymuszony błąd daje `failed` i wiersz `OPERATOR_ALERT`; `/health` z `jobs` (`ok`, `stale` po postarzeniu wierszy); 503 przy błędzie bazy bez zmian.

### Manual Testing Steps:

1. Lokalnie `start:dev`: trzy linie podsumowania, trzy wiersze `job_run`, `/health` z `jobs`.
2. Lokalna próba watchdoga przy zatrzymanym API: mail przy 3. uruchomieniu, potem jeden „działa ponownie”.
3. Produkcja: zatrzymanie API daje mail w ~15 min, start daje mail o powrocie, deploy przechodzi bez alarmu.

## Performance Considerations

`/health` dostaje jedno zapytanie o ostatni zakończony przebieg każdego zadania. Tabela ma kilka wierszy dziennie i indeks `(job, started_at)`, a watchdog woła `/health` co 5 minut. Retencja 90 dni trzyma tabelę na poziomie kilkuset wierszy.

## Migration Notes

Nowa tabela, bez zmian istniejących danych. Na produkcji migracja wchodzi w `deploy.sh` po `pg_dump` (`lessons.md`). Do pierwszego przebiegu po deployu tabela jest pusta, ale przebiegi startowe zapisują wiersze, zanim pierwsze zadania zgłoszą `stale`. Przebieg przypomnień w tle może przez kilka sekund nie mieć wiersza zakończonego. Watchdog alarmuje dopiero po 3 kolejnych porażkach, czyli po 15 minutach, a `stale` liczy 26 h, więc to okno nie daje alarmu.

## References

- Roadmapa: `context/foundation/roadmap.md`, S-11; PRD v2 FR-019.
- Audyt: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md`, ustalenia P1, J1, J2, J3, J4; §6 pkt 1.
- Wzorzec schedulera: `context/foundation/backend-patterns.md`, „Cykl życia i zadania cykliczne”.
- Wzorzec skryptu z crona: `deploy/mydevil/prune-backups.sh`; uruchamianie `cli/*.js`: `deploy/mydevil/README.md:139-153`.
- Transport operatora: `backend-subtracker/src/mail/mail.transport.ts:97-112`; `MailService.notifyOperator`: `mail/services/mail.service.ts:96`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rejestr przebiegów i alarm z API

#### Automated

- [x] 1.1 Migracja `JobRun` wygenerowana względem `subtracker-db`, przejrzana i zastosowana
- [x] 1.2 Testy jednostkowe `JobRunService` i `job-run-alert`
- [x] 1.3 Testy e2e: wiersze `success` po starcie, `failed` + `OPERATOR_ALERT` przy błędzie
- [x] 1.4 Celowe uszkodzenie `track` czerwieni test
- [x] 1.5 Lint i build backendu
- [x] 1.6 Wszystkie testy backendu

#### Manual

- [x] 1.7 Lokalnie trzy linie podsumowania i trzy wiersze `job_run` po `start:dev`

### Phase 2: `/health` z polem `jobs` i handlery procesu

#### Automated

- [ ] 2.1 Testy jednostkowe `jobHealth` i `installFatalHandlers`
- [ ] 2.2 Test e2e `/health` z `jobs` (`ok`, `stale` po postarzeniu)
- [ ] 2.3 Istniejące testy `/health` zielone
- [ ] 2.4 Celowe uszkodzenie progu 26 h czerwieni test
- [ ] 2.5 Lint i build backendu

#### Manual

- [ ] 2.6 Lokalnie `curl /health` pokazuje pole `jobs`

### Phase 3: Watchdog

#### Automated

- [ ] 3.1 Testy jednostkowe `decide`
- [ ] 3.2 Celowe uszkodzenie progu 3 albo 12 h czerwieni test
- [ ] 3.3 Shellcheck skryptów MyDevil czysty
- [ ] 3.4 Lint i build backendu, `cli/watchdog.js` w paczce

#### Manual

- [ ] 3.5 Lokalna próba: mail przy 3. porażce i jeden mail o powrocie

### Phase 4: Dokumentacja i produkcja

#### Automated

- [ ] 4.1 CI zielone na PR

#### Manual

- [ ] 4.2 Po deployu `/health` na serwerze pokazuje `jobs` z `ok`
- [ ] 4.3 `watchdog.sh` wgrany, wpis w crontabie, ręczne uruchomienie bez maila
- [ ] 4.4 Zatrzymane API daje mail w ~15 min, start daje mail o powrocie
- [ ] 4.5 Deploy bez fałszywego alarmu
