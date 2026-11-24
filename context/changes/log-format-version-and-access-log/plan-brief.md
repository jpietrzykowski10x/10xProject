# Format logu, wersja i access log — Plan Brief

> Full plan: `context/changes/log-format-version-and-access-log/plan.md`
> Research: `context/changes/log-format-version-and-access-log/research.md`

## What & Why

FR-022 (S-14): logi API i serwera SSR mają być czytelne i przeszukiwalne w plikach na serwerze, mówić, która wersja jest wdrożona, i pokazywać ruch (statusy, czasy) każdej trasy. Dziś:
- `out.log`/`err.log` mają kody ANSI i lokalny czas bez strefy;
- nikt nie czyta SHA z `.deploy-info`;
- żaden proces nie ma access logu;
- kilka linii `err.log` nadal niesie treść błędu bazy (zaległe z S-16).

## Starting Point

API używa domyślnego `ConsoleLogger` Nest bez konfiguracji (`main.ts:14`), baner startowy to trzy kolorowe `console.log`, a serwer SSR ma jedną linię `console.log` startu. Jest kontekst żądania z S-13 (`assignRequestId`, `describeRequest`), `failureCodeOf` z S-16 i `.deploy-info` pisane przez `deploy.sh`.

## Desired End State

- Obie aplikacje piszą `[<app>] <pid>  - <ISO Warszawy z offsetem> <LEVEL> [<Context>] <wiadomość>`.
- Kolory i wyróżnienia (baner, podsumowania jobów) są tylko w terminalu.
- `/health` i linie startowe podają SHA.
- Każde żądanie ma linię `Access` z metodą, szablonem albo ścieżką bez query, statusem i czasem.
- W `err.log` nie ma treści komunikatów bazy.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Kolory | Tylko gdy `stdout` jest TTY i brak `NO_COLOR` | W terminalu czytelniej, w plikach kody psują `grep`, podgląd i analizę | Plan (użytkownik) |
| Wyróżnienia | Przywrócone w terminalu: tło banera i podsumowań jobów (zielone `success`, czerwone `partial`/`failed`) | Wraca wycofane w S-11 zielone tło przypomnień, teraz dla wszystkich jobów | Plan (użytkownik) |
| Format | Tekst, nie JSON | Czytelny w `tail`, najmniejsza zmiana testów | Research → Plan |
| Strefa znacznika | ISO z offsetem Warszawy | Godzina w logu = godzina joba i zgłoszenia, offset rozróżnia podwójną 02:00 | Plan (użytkownik) |
| Mechanizm | Podklasa `ConsoleLogger` (`AppLogger`) w `NestFactory.create` | Bez zmiany wywołań `Logger`, obejmuje też linie bootstrapu | Research |
| Stosy | Zostają; `QueryFailedError` bez komunikatu (`safeStack`) | Stos pomaga w diagnozie, a komunikat PG może cytować adres | Research → Plan |
| Treść błędów | `(code: <failureCodeOf>)` zamiast `message` w sprawdzonych liniach | Domyka F3 z S-16 | Research |
| Access log API | Middleware po `assignRequestId`, poziom `log`, kontekst `Access` | Widzi 404, guardy, CSRF; nie łamie e2e liczących `warn`/`error` | Research |
| Access log SSR | Po `express.static`, `req.path` bez query, przycięta, tylko gdy serwer nasłuchuje | Bez plików statycznych, bez `q` z `/admin/users`, bez linii przy buildzie | Research → Plan |
| Sondy | `/health` i `GET /` watchdoga logowane | ~288 linii na dobę na proces, za to pełny obraz | Research → Plan |
| Wersja | `SHA=` z `.deploy-info` w `cwd`, fallback `dev`; `/health.version` (200 i 503); frontend tylko linia startowa | Plik już jest, nigdy `BACKUP`; frontend nie ma `/health` | Research → Plan |

## Scope

**In scope:**
- `AppLogger` i helpery formatu;
- linia startowa i `Fatal` w tym formacie;
- wyróżnienia w terminalu;
- linie bez treści błędu bazy;
- odczyt `.deploy-info`, `/health.version`;
- access log API i SSR;
- moduł logu frontendu;
- dokumenty i weryfikacja na serwerze.

**Out of scope:**
- JSON;
- stos w jednej linii;
- rotacja logów;
- pomijanie sond;
- logowanie plików statycznych;
- `/health` we frontendzie;
- zmiana `jobs` w `/health`;
- format CLI i skryptów powłoki;
- błędy SSR i guardów (S-15);
- limit linii access logu.

## Architecture / Approach

W API helpery formatu (`shared/logging/log-format.ts`) dają znacznik, decyzję o kolorach, wyróżnienie i `safeStack`. Korzysta z nich `AppLogger`, przekazany do `NestFactory.create`, oraz linia `Fatal`. Access log to middleware w `applyHttpSecurity`, które składa linię z `describeRequest`. Wersję czyta `shared/deploy/deploy-info.ts`, raz przy starcie. Frontend ma własny mały `server-log.ts` z tą samą specyfikacją i testem, używany w `server.ts`. Testy biegną z `NO_COLOR=1`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Format logu API | `AppLogger`, ISO Warszawy, kolory tylko TTY, wyróżnienia, bez treści błędów bazy | Specy przypinające dawny tekst linii; determinizm testów w terminalu |
| 2. Wersja w API | `.deploy-info` → linia startowa i `/health.version` | Testy `toEqual` kształtu `/health` |
| 3. Access log API | Linia `Access` na żądanie, e2e bez query i adresu | Podwójna linia przy `finish`+`close`; dane osobowe w ścieżce |
| 4. Serwer SSR | `server-log.ts`, linia startowa z SHA, access log | Linie przy prerenderze; e2e http |
| 5. Dokumenty i produkcja | `backend-patterns.md`, `CLAUDE.md`, README; sprawdzenie na serwerze | Brak kodów ANSI potwierdzony dopiero na MyDevil |

**Prerequisites:** S-13 na `main` (spełnione); lokalne bazy i `backend-subtracker/.env`.
**Estimated effort:** ~2–3 sesje; fazy 1–4 nadają się do przebiegu `/goal`, faza 5 wymaga człowieka (deploy, serwer).

## Open Risks & Assumptions

- Zakładamy, że `forever` pod `start-app.sh` nie daje TTY (pliki `-o`/`-e`), więc kolory same znikną na serwerze; potwierdza to 5.4.
- `cwd` procesu na serwerze to katalog wydania (`--workingDir`); jeśli nie, wersja pokaże `dev`, co wyjdzie w 5.3.
- Objętość access logu rośnie bez rotacji; zabezpieczeniem jest cotygodniowy `truncate` > 20 MB.

## Success Criteria (Summary)

- W plikach logów na serwerze nie ma kodów ANSI, znaczniki mają offset, a w terminalu są kolory i wyróżnienia.
- `/health` i linie startowe podają SHA wdrożenia.
- Każde żądanie obu procesów ma linię `Access` bez query i danych osobowych.
- W `err.log` nie ma treści komunikatów bazy.
