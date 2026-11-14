# Izolacja kont i e2e backendu w CI — Plan Brief

> Full plan: `context/changes/backend-e2e-account-isolation/plan.md`
> Research: `context/changes/backend-e2e-account-isolation/research.md`

## What & Why

Etap 3 planu testów (ryzyka #1 IDOR, #5 locale `C.UTF-8`, #6 link i sesja). E2e backendu już pokrywają
prawie wszystkie te zachowania, ale nie biegną w CI, a lokalna baza (`Polish_Poland.1250`) nie łapie
błędów sortowania, które wyjdą na produkcji (`C.UTF-8`). Trasy po id, których dotyczy #1, dopiero
powstaną (S-03, S-10), więc potrzebny jest wzorzec i strażnik, zanim się pojawią.

## Starting Point

Job `backend` w CI uruchamia lint, unit i build, bez Postgresa. Trzy pliki e2e biegną tylko ręcznie
na lokalnej bazie; pomocniki (start aplikacji, logowanie, sprzątanie) są skopiowane w dwóch plikach,
a `auth.e2e-spec.ts` ma 711 linii.

## Desired End State

Każdy push i PR uruchamia `backend-e2e` na Postgresie 16 `C.UTF-8` ze schematem z migracji; job jest
wymaganym checkiem. Nowa trasa nie wejdzie bez wpisu na liście tras, a trasa po id bez testu dwóch kont.
Pliki e2e są krótkie i oparte na wspólnym pomocniku, a §6.4 planu testów mówi, jak dodać test API.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Baza w CI | Usługa `postgres:16` w GitHub Actions, initdb `C.UTF-8`, bez MyDevil | Taka sama wersja i locale jak produkcja, nic nie łączy się z serwerem | Research |
| Schemat i seedy | `migration:run`, `DATABASE_AUTO_SYNCHRONIZATION=false`, jedna baza dla CLI i aplikacji | Sprawdza ścieżkę produkcyjną; role i kategorie przychodzą z migracji | Research |
| Zmienne w CI | `.env` zapisany w kroku joba, bez sekretów; Postgres z `trust`, bez hasła w repo | `loadEnv` i CLI migracji czytają `.env`; żadnych haseł w plikach | Research / Plan |
| Limit wysyłki maili | Poza zakresem (§7) | Funkcji celowo nie ma w MVP | Research |
| Kształt CI | Osobny job `backend-e2e` + ręczny wpis w rulesecie | Czytelny osobny check, lint i unit nie czekają na Postgresa | Plan |
| Pomocnik | `test/support/` + przepięcie `subscriptions`; `auth` podzielony na pliki tematyczne | Wzorzec dla S-03 ma prawdziwego użytkownika; 711 linii to za dużo | Plan |
| Strażnik tras | e2e porównujący trasy Nesta z jawną listą; trasa z `:` musi wskazać test dwóch kont | Jedyny tani sposób pilnowania #1 dla tras, których jeszcze nie ma | Plan |
| Kolejność | CI najpierw, refaktory potem | Niewiadome (ICU, initdb) są w CI, a refaktory przechodzą już przez bramkę | Plan |

## Scope

**In scope:** job `backend-e2e`, kontrola locale i kolacji, sabotaż `COLLATE`, wpis w rulesecie,
pomocnik w `test/support/`, sesja wygasła/wylogowana na trasach domenowych, strażnik tras, podział auth,
§6.4/§6.6/§4/§5 i drobne poprawki dokumentacji.

**Out of scope:** testy tras po id (nie istnieją), limit maili, kolejność własnych kategorii, baza na
MyDevil, zmiany w `src/`, kontrola rozjazdu encji i migracji w CI.

## Architecture / Approach

Usługa Postgres w jobie → `docker exec psql` sprawdza `C.UTF-8`, `pl-PL-x-icu` i `'Ślub' < 'Zoo'` →
heredoc `.env` (DEV, jedna baza, bez synchronize) → `migration:run` → `test:e2e`. W testach fabryka z
`test/support/` startuje `AppModule` jak `main.ts`, przechwytuje maile, zakłada konta (`signIn`,
`twoAccounts`) i sprząta po prefiksie pliku; strażnik tras czyta kontrolery przez `DiscoveryService`
i `@Public()` przez `Reflector`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Job `backend-e2e` w CI | E2e w CI na `C.UTF-8`, sabotaż `COLLATE`, required check | Obraz bez ICU / initdb nie przyjmie `C.UTF-8`; flaki `vi.waitFor` na runnerze |
| 2. Pomocnik i strażnik tras | `test/support/`, `subscriptions` na pomocniku, 401 sesji na trasach domenowych, `routes.e2e-spec.ts` | Wyliczanie tras przez metadane Nesta zależne od wersji |
| 3. Podział auth | Pliki tematyczne, ta sama liczba testów i asercje | Przypadkowa zmiana asercji przy przenoszeniu |
| 4. Dokumentacja | §6.4, §6.6, §4, §5, `CLAUDE.md`, komentarz `app.e2e-spec` | — |

**Prerequisites:** lokalne bazy i `.env` (jak dziś dla `test:e2e`); push gałęzi i zmiana rulesetu po
stronie użytkownika; `gh` tylko do odczytu wyników CI.
**Estimated effort:** ~2 sesje (faza 1 z oczekiwaniem na CI, fazy 2–3 refaktor, faza 4 krótka).

## Open Risks & Assumptions

- `postgres:16` (Debian) ma ICU i `C.UTF-8` — niezweryfikowane; job to sprawdza i odpada z czytelnym logiem.
- Przechwycenie maila z domyślnym 1 s `vi.waitFor` może być niestabilne na runnerze; wtedy limit
  czasu w pomocniku (faza 2).
- Między fazą 1 a wpisem w rulesecie PR mógłby przejść z czerwonym e2e — wpis zaraz po pierwszym
  zielonym przebiegu.

## Success Criteria (Summary)

- PR do `main` nie przejdzie z czerwonym e2e, a e2e biegną na tym samym locale co produkcja.
- Brak `COLLATE` przy sortowaniu tekstu daje czerwony CI, choć lokalnie jest zielono.
- Autor S-03 dodaje trasę po id z testem dwóch kont według §6.4, a strażnik nie pozwoli o tym zapomnieć.
