---
date: 2026-11-13T21:53:49+01:00
researcher: Claude (Opus 5.5)
git_commit: a292e2f
branch: change/backend-e2e-account-isolation
repository: 10xProject
topic: "Etap 3 planu testów: izolacja kont i e2e backendu w CI (ryzyka #1, #5, #6)"
tags: [research, test-plan, backend, e2e, ci, auth, subscriptions, collation]
status: complete
last_updated: 2026-11-13
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Decyzje użytkownika: brak limitu wysyłki maili w MVP; schemat w CI z migracji na jednorazowej bazie w GitHub Actions"
---

# Research: etap 3 planu testów — izolacja kont i e2e backendu w CI

**Date**: 2026-11-13T21:53:49+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: a292e2f (working tree: zmieniony `context/foundation/test-plan.md`)
**Branch**: change/backend-e2e-account-isolation
**Repository**: 10xProject

## Research Question

Oprzeć na kodzie etap 3 z `context/foundation/test-plan.md` („Account isolation and backend e2e in CI”):

- **#1 (IDOR)**: konto B dostaje 404/403 przy każdym odczycie i zapisie zasobu konta A, a lista B nie zawiera danych A. Do podważenia: „zalogowany = uprawniony” oraz „test listy wystarcza”.
- **#5 (`C.UTF-8`)**: nazwy różniące się wielkością polskich liter są duplikatem, a sortowanie jest polskie. Test nie może biec tylko na lokalnym `Polish_Poland.1250`.
- **#6 (nadużycie logowania)**: drugie użycie linku i link po terminie są odrzucane, a wygasła sesja dostaje 401. Najpierw trzeba sprawdzić, co pokrywają istniejące e2e, zamiast je dublować. Brakuje uruchamiania ich w CI.

## Summary

1. **Największa luka to brak CI, a nie brak testów.** Trzy pliki e2e w `backend-subtracker/test/` już pokrywają prawie wszystkie zachowania wymienione dla #1, #5 i #6. Żaden z nich nie biegnie w CI. Job `backend` w `.github/workflows/ci.yml:38-41` uruchamia `npm ci`, `lint`, `npm test` i `prepare-mydevil`. Nie ma tam `test:e2e` ani usługi Postgresa (`services:`).
2. **#1: dziś w API nie ma trasy przyjmującej id zasobu w ścieżce.** Uwierzytelnione trasy to cztery: `GET/POST /categories`, `GET/POST /subscriptions` i `GET /auth/me`. Wszystkie zawężają dane do `userId` z sesji. Jedyne obce id przychodzi w ciele żądania (`categoryId` w `POST /subscriptions`) i przechodzi przez `findUsable` (`categories.service.ts:80-86`). Test na dwóch kontach już istnieje (`test/subscriptions.e2e-spec.ts:245-285`). Ryzyko #1 dotyczy więc przyszłych tras po id (S-03, S-10). Etap 3 powinien dać im **wzorzec** (pomocnik dwóch kont i wpis §6.4), a nie testy tras, których jeszcze nie ma.
3. **#5: e2e mają sens tylko na bazie, która naprawdę ma `C.UTF-8`.** Unikalność nazw kategorii nie zależy od locale bazy, bo klucz składa aplikacja (`toNameKey` = `toLocaleLowerCase('pl')`, `src/shared/text/name-key.ts:5-6`). Kategorie sortuje JS (`categories.service.ts:47`). Od locale bazy zależy tylko sortowanie listy subskrypcji, które ma jawne `COLLATE "pl-PL-x-icu"` (`subscription-order.ts:42`). Test polskiej kolejności istnieje (`subscriptions.e2e-spec.ts:447-456`), ale lokalnie przejdzie także bez `COLLATE`. Na oficjalnym obrazie `postgres` z domyślnym locale (wg pamięci agenta `en_US.utf8`, niezweryfikowane) najpewniej też przejdzie. Baza w CI musi więc być założona jawnie jako `C.UTF-8`, a job musi to sprawdzić zapytaniem.
4. **#6: trzy zachowania z „What would prove protection” są już pokryte.** Drugie użycie linku daje 401 (`auth.e2e-spec.ts:316-324`), link po terminie 401 (`:342-354`), a wygasła sesja 401 (`:623-634`). Pokryte są też współbieżne verify (`:326`) i wylogowanie (`:594`). **Ochrony przed zalewem maili nie ma w kodzie.** To świadoma decyzja MVP (`context/archive/2026-11-03-magic-link-sign-in/plan.md:40`). Dopisanie takiego testu byłoby pracą nad funkcją, a nie nad testami. Ten fragment ryzyka #6 należy oddać do `/10x-test-plan` (korekta §2 albo wpis w §7).
5. **Do CI potrzeba trzech rzeczy:** baza z seedami (dziś seedy ról i kategorii domyślnych robią tylko seedery przy `synchronize`), zmienne środowiska (config e2e czyta `.env` przez `loadEnv`) oraz kolacja ICU `pl-PL-x-icu` w obrazie Postgresa.

## Detailed Findings

### Trasy i zawężanie po właścicielu (#1)

- Guardy globalne: `SessionAuthGuard` i `RolesGuard` jako `APP_GUARD` (`src/auth/auth.module.ts:20-21`). Kod w `src/` poza specami nie używa `@Roles(...)` ani `@UseGuards` na kontrolerach. Moduł `users/` nie ma kontrolera.
- Trasy z `@Public()`: `GET /`, `GET /health`, `POST /auth/register`, `POST /auth/request-link`, `POST /auth/verify`, `GET /auth/session` i `POST /auth/logout` (`auth.controller.ts:30-80`, `health.controller.ts:19-20`, `app.controller.ts:9-10`). `logout` unieważnia tylko sesję, której token niesie ciasteczko (`session.service.ts:100-104`).
- Uwierzytelnione trasy domenowe (zbiór sprawdzony grepem po `@Controller` i dekoratorach tras w `src/`):
  - `GET /categories`: `where: [{ userId: IsNull() }, { userId }]` (`src/subscriptions/services/categories.service.ts:35-37`).
  - `POST /categories`: kontrola duplikatu w zakresie `userId IS NULL OR userId = :userId` (`:57`), zapis z `userId` z sesji (`:68`).
  - `GET /subscriptions`: `.where(\`${LIST_ALIAS}.userId = :userId\`)` (`src/subscriptions/services/subscriptions.service.ts:51`).
  - `POST /subscriptions`: `categoryId` (`@IsUUID()`) przechodzi przez `findUsable(userId, dto.categoryId)` (`subscriptions.service.ts:63`, `categories.service.ts:80-86`). Gdy wynik jest null, odpowiedź to 400 (`subscriptions.service.ts:64-67`). Cudza kategoria daje ten sam 400 co nieistniejąca.
- `userId` w ciele żądania daje 400, bo `ValidationPipe` działa z `whitelist: true, forbidNonWhitelisted: true` (`src/app.module.ts:40-43`). Pokrywa to test `subscriptions.e2e-spec.ts:269-283`.
- **Brak gwarancji w bazie:** `subscription.category_id` ma FK tylko do `category.id` (`subscription.entity.ts:38-44`). Zgodności `subscription.user_id` z `category.user_id` pilnuje jedynie `findUsable`. Przyszła ścieżka zmiany `categoryId` (np. edycja w S-03) musi go użyć. Lista subskrypcji dołącza kategorię joinem bez filtra właściciela (`subscriptions.service.ts:50`). To jest bezpieczne tylko dzięki tej zasadzie.
- Wniosek dla „Must challenge”:
  - „Zalogowany = uprawniony”: na obecnych trasach podważone kodem i testem, bo dane są zawężone do właściciela.
  - „Test listy wystarcza, choć dochodzą trasy po id”: zasadne, ale trasy po id jeszcze nie istnieją. Dziś da się pokryć tylko listę, zapis i obce id w ciele, i to jest już pokryte.

### Istniejące e2e — inwentarz pokrycia

Pliki: `test/app.e2e-spec.ts` (135 linii), `test/auth.e2e-spec.ts` (711), `test/subscriptions.e2e-spec.ts` (482).

| Zachowanie z planu testów | Stan | Kotwica |
|---|---|---|
| #6 drugie użycie linku → 401 | pokryte | `auth.e2e-spec.ts:316-324` |
| #6 link po terminie → 401, e-mail niepotwierdzony | pokryte | `auth.e2e-spec.ts:342-354` |
| #6 współbieżne verify → `[200, 401]`, 1 sesja | pokryte | `auth.e2e-spec.ts:326-340` |
| #6 starszy link po wydaniu nowszego → 401 | pokryte | `auth.e2e-spec.ts:356` |
| #6 wygasła sesja → 401 na `/auth/me` | pokryte | `auth.e2e-spec.ts:623-634` |
| #6 ciasteczko po wylogowaniu → 401 | pokryte | `auth.e2e-spec.ts:594` |
| #6 brak ciasteczka → 401 na trasach domenowych | pokryte (4 trasy) | `subscriptions.e2e-spec.ts:191-196` |
| #6 wygasła/wylogowana sesja na trasach domenowych | **niepokryte**; ten sam globalny guard jest pokryty na `/auth/me` | — |
| #6 limit wysyłki maili | **brak funkcji w kodzie**; testy zakładają, że kolejny mail wychodzi (`auth.e2e-spec.ts:260-276`) | `archive/2026-11-03-magic-link-sign-in/plan.md:40` |
| #1 lista i kategorie B bez danych A | pokryte | `subscriptions.e2e-spec.ts:256-259` |
| #1 B używa `categoryId` A → 400 | pokryte | `subscriptions.e2e-spec.ts:261-264` |
| #1 `userId` w ciele → 400 | pokryte | `subscriptions.e2e-spec.ts:269-283` |
| #1 odczyt/zapis zasobu po id | **nie dotyczy** (brak tras) | — |
| #5 `Ślub` / `ślub` / `ŚLUB` → duplikat (409) | pokryte | `subscriptions.e2e-spec.ts:350-369` |
| #5 wyścig `Netto` / `netto` → `[201, 409]` | pokryte | `subscriptions.e2e-spec.ts:371` |
| #5 indeks unikalny w bazie (23505) | pokryte | `subscriptions.e2e-spec.ts:388-402` |
| #5 polska kolejność subskrypcji | pokryte, ale bez sygnału na lokalnej bazie | `subscriptions.e2e-spec.ts:447-456` |
| #5 polska kolejność własnych kategorii | sortowanie w JS; test używa tylko nazw `Auto`, `Zwierzęta` | `subscriptions.e2e-spec.ts:328-347`, `categories.service.ts:47` |

Infrastruktura testów:

- Każdy plik uruchamia prawdziwy `AppModule` (`Test.createTestingModule({ imports: [AppModule] })`) z `applyHttpSecurity`. Wzorce są w `subscriptions.e2e-spec.ts:147-170` i `auth.e2e-spec.ts:133-156`.
- Mail jest przechwytywany przez nadpisanie `MAIL_TRANSPORT` tablicą w pamięci. Token pochodzi z treści maila (`vi.waitFor`).
- Konta powstają prawdziwym przepływem register → verify. `signIn` jest zdefiniowany osobno w każdym pliku (`subscriptions.e2e-spec.ts:92`, `auth.e2e-spec.ts:118`). Wspólnego pomocnika nie ma.
- Sprzątanie usuwa wiersze po prefiksie adresu (`e2e-auth-…`, `e2e-subscriptions-…`) w `beforeAll` i `afterAll` (`subscriptions.e2e-spec.ts:54-70`, `auth.e2e-spec.ts:47-57`). Nic nie jest truncowane.
- Pliki biegną szeregowo (`vitest.config.e2e.ts:16`, `fileParallelism: false`).

### Locale bazy, kolacja i unikalność (#5)

- Produkcja: `datcollate`/`datctype` = `C.UTF-8`, PostgreSQL 16.10, kolacje ICU dostępne (`src/shared/database/polish-collation.ts:2-4`, `deploy/mydevil/README.md:73`).
- `POLISH_COLLATION = 'pl-PL-x-icu'` (`polish-collation.ts:5`) ma jedno użycie w kodzie: sortowanie subskrypcji po nazwie (`src/subscriptions/subscription-order.ts:42`). Żadna migracja nie wykonuje `CREATE COLLATION`, więc kod zakłada Postgresa zbudowanego z ICU. Bez tej kolacji zapytanie listy subskrypcji kończy się błędem i w e2e padają wszystkie testy listy (wniosek z kodu, nieuruchamiany).
- Unikalność: indeks wyrażeniowy `UQ_category_owner_name_key` na `(COALESCE(user_id, zero-uuid), name_key)` (`category.entity.ts:25`). `name_key` składa aplikacja (`toNameKey`, `src/shared/text/name-key.ts:5-6`), a nie `lower()` w SQL. Migracja `1794424078141-CategoryNameKey.ts:17` wypełniła istniejące wiersze przez `lower("name")` (jednorazowo, na produkcji `C.UTF-8`, gdzie `lower()` zmienia polskie litery — `archive/2026-11-11-first-subscription-in-list/plan.md:339`).
- Co e2e na `C.UTF-8` naprawdę sprawdza:
  - Unikalność nie zależy od locale bazy. Sygnał jest ten sam lokalnie i w CI. Wartość CI to tylko pilnowanie regresji, gdyby ktoś zastąpił `toNameKey` przez `lower()` w SQL. Na `C.UTF-8` `lower()` i tak zmienia polskie litery, więc nawet ta regresja może przejść; pewny jest tylko przypadek `LC_CTYPE=C` (`name-key.ts:2-3`).
  - Sortowanie subskrypcji to jedyny test, którego wynik zależy od locale bazy. Sabotaż (usunięcie `COLLATE` w `subscription-order.ts:42`) da czerwony test tylko na bazie `C.UTF-8`. Lokalnie i prawdopodobnie na domyślnym `en_US.utf8` pozostanie zielony.
- Baza w CI: oficjalny obraz `postgres:16` (wersja jak na produkcji). Locale `C.UTF-8` ustawia się przy initdb (`POSTGRES_INITDB_ARGS`, np. `--locale=C.UTF-8`) albo przez `CREATE DATABASE … TEMPLATE template0 LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`. **Niezweryfikowane w tym researchu** (wiedza agenta, bez lektury dokumentacji): czy obraz Debian zawiera ICU z `pl-PL-x-icu` i czy initdb przyjmie `C.UTF-8`. Job CI powinien przed testami sprawdzić `SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()` i obecność `pl-PL-x-icu` w `pg_collation`, i odpaść, gdy wynik jest inny.

### CI i uruchomienie e2e na świeżej bazie

- `ci.yml:6-10` uruchamia CI na push do każdej gałęzi poza `main` oraz na PR do `main`. Job `backend` (`:24-41`) używa Node 24 i kroków `npm ci`, `npm run lint`, `npm test`, `npm run prepare-mydevil`. Nie ma usługi Postgresa.
- Konfiguracja e2e czyta zmienne przez `loadEnv('', process.cwd(), '')` (`vitest.config.e2e.ts:13`), czyli z `.env`. Komentarz (`:11-12`) mówi, że MODE z `.env` ma przykryć `MODE=test` ustawiane przez Vitest. Czy zmienne wyeksportowane w środowisku joba przejdą tą samą drogą, nie zostało zweryfikowane. Najprostsza bezpieczna droga to zapisanie `.env` w kroku CI, z wartościami bez sekretów: lokalny serwis z jednorazowym hasłem.
- Wymagane klucze (`src/config/env.ts`): `MODE` (DEV|PROD), `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` (wymagany także w DEV), `CORS_ORIGINS`, a w DEV dodatkowo `POSTGRES_DATABASE_DEV` (`:140-142`). Bez `SMTP_HOST` DEV używa konsoli (`:143-145`). PROD wymaga SMTP i https `FRONTEND_URL`, więc na testy się nie nadaje.
- Schemat i seedy — dwie drogi:
  - **(a) `synchronize`**: `MODE=DEV`, `DATABASE_AUTO_SYNCHRONIZATION=true` (`env.ts:274-275`, `database.options.ts:49`). Seedery `RolesSeeder` (`src/users/services/roles-seeder.ts:21-31`) i `CategoriesSeeder` (`src/subscriptions/services/categories-seeder.ts:28-52`) zakładają role, kategorie domyślne i ręczny indeks unikalny. Tak samo działa to lokalnie.
  - **(b) migracje**: `npm run migration:run` na `POSTGRES_DATABASE` (target `cli`, `database.options.ts:56-59`), a potem aplikacja bez `synchronize`, z `POSTGRES_DATABASE_DEV` wskazującym tę samą bazę. Seedy `SeedRoles` i `SeedDefaultCategories` pochodzą wtedy z migracji. Ta droga przy okazji sprawdza migracje na czystej bazie, czyli ścieżkę produkcyjną. Lokalnie `migration:*` celuje w `subtracker-db`, a reguła z `lessons.md` zabrania kierowania CLI migracji na bazę `-dev`. W CI jest jedna jednorazowa baza, więc reguła nie ma tu zastosowania, ale plan powinien to nazwać.
  - `AuthService` rzuca błąd, gdy brakuje roli USER (`auth.service.ts:149`). Bez seedów każdy test logowania padnie.
- SMTP nie jest potrzebny. Transport jest nadpisany w `auth` i `subscriptions`, a plik `app` nie wysyła maili.
- Ryzyko flaków: `vi.waitFor` z domyślnym 1 s na przechwycenie maila (inwentarz agenta, nieuruchamiane).

## Code References

- `.github/workflows/ci.yml:24-41` — job backendu bez e2e i bez Postgresa
- `backend-subtracker/vitest.config.e2e.ts:11-16` — `loadEnv` z `.env`, szeregowe pliki
- `backend-subtracker/src/auth/auth.module.ts:20-21` — globalne guardy
- `backend-subtracker/src/subscriptions/services/categories.service.ts:35-37, 47, 57, 68, 80-86` — zawężanie po właścicielu, sortowanie w JS, `findUsable`
- `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:50-51, 63-67` — lista po `userId`, kontrola kategorii przy zapisie
- `backend-subtracker/src/subscriptions/subscription-order.ts:42` — jedyne użycie `COLLATE "pl-PL-x-icu"`
- `backend-subtracker/src/shared/database/polish-collation.ts:1-5` — locale produkcji
- `backend-subtracker/src/shared/text/name-key.ts:1-6` — klucz nazwy składany w aplikacji
- `backend-subtracker/src/subscriptions/entities/category.entity.ts:25-36` — indeks unikalny, `user_id` NULL = kategoria domyślna
- `backend-subtracker/src/config/env.ts:123-145, 268-276` — MODE, wymagane klucze, `synchronize`
- `backend-subtracker/src/database/database.options.ts:34, 49, 56-59` — `migrationsRun: false`, `synchronize`, target `cli`
- `backend-subtracker/test/auth.e2e-spec.ts:316-354, 594, 623-634` — reguły tokenu i sesji
- `backend-subtracker/test/subscriptions.e2e-spec.ts:191-196, 245-285, 350-402, 447-456` — 401, izolacja, unikalność, polska kolejność

## Architecture Insights

- Izolacja kont działa na zasadzie „serwis filtruje po `currentUser.id`, a `userId` nigdy nie przychodzi z ciała” (`context/foundation/backend-patterns.md:22`, `subscriptions.service.ts:35`). Test dwóch kont jest więc testem serwisu przez HTTP: najtańsza warstwa z sygnałem to e2e API na prawdziwej bazie, zgodnie z §2.
- Zależność od locale bazy zamknięto w dwóch miejscach: klucz nazwy składa aplikacja, a SQL dostaje jawne `COLLATE`. Baza `C.UTF-8` w CI pilnuje, żeby nowe `ORDER BY` po tekście nie pominęło `COLLATE`. Lokalnie tego nie widać.
- Pomocniki e2e (`signIn`, `newAddress`, `removeTestData`, przechwytywanie maila) są skopiowane w dwóch plikach. Wzorzec dwóch kont dla przyszłych tras po id wymaga wspólnego pomocnika w `test/`, inaczej każdy nowy plik powieli ten kod.

## Historical Context (from prior changes)

- `context/archive/2026-10-16-production-database-wiring/plan.md:26, 56` — e2e w CI wprost wyłączone z zakresu („wymagałoby bazy w Actions”). Nadal aktualne: CI ich nie uruchamia.
- `context/archive/2026-11-03-magic-link-sign-in/plan.md:40, 442` — brak limitów wysyłki to decyzja MVP; e2e uruchamiane ręcznie przed merge'em „do Modułu 3”. Nadal aktualne, kod nie ma throttlingu.
- `context/archive/2026-11-03-magic-link-sign-in/plan-brief.md:74` — „1 link na 60 sekund per adres” jako mały dodatek „przed publicznym startem”. To propozycja, niezrealizowana.
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:305-306` — e2e pokrywa izolację kont; sabotaż „usunięcie filtra po `user_id`” ma dać czerwony test. Potwierdzone testem `subscriptions.e2e-spec.ts:245-268`.
- `context/foundation/backend-patterns.md:101` — lokalne bazy sortują poprawnie, więc e2e nie złapią braku `COLLATE`. Potwierdzone kodem i testem `:447-456`. Etap 3 zamyka tę lukę w CI.

## Related Research

- `context/archive/*-frontend-unit-tests/research.md` i `*-frontend-component-tests/research.md` — etapy 1–2 tego samego planu testów (front, nie dotyczą tych ryzyk).

## Decisions (2026-11-13, użytkownik)

- **Limit wysyłki maili (#6): bez limitu w MVP**, ewentualny powrót po MVP. Etap 3 nie testuje zalewu maili. Korekta dla `/10x-test-plan`: zawęzić #6 w §2 do linków i sesji, a limit wysyłki wpisać do §7 z warunkiem powrotu „po MVP / przed publicznym startem”.
- **Schemat w CI: migracje.** Baza testowa to jednorazowy kontener usługi Postgres w jobie GitHub Actions (`postgres:16`, initdb z `C.UTF-8`). Powstaje na początku joba i znika po nim. **Nie potrzeba żadnej bazy na MyDevil.** Testy nie dotykają produkcji ani serwera, a runner GitHub nie łączy się z MyDevil. Kolejność w jobie: (1) sprawdzenie locale i `pl-PL-x-icu`, (2) zapis `.env` z wartościami tylko dla tego kontenera, bez sekretów repozytorium, (3) `npm run migration:run` (target `cli`, `POSTGRES_DATABASE`), (4) `npm run test:e2e` z `MODE=DEV`, `POSTGRES_DATABASE_DEV` = ta sama baza, `DATABASE_AUTO_SYNCHRONIZATION=false`. Seedery uruchamiane tylko przy `synchronize` wtedy się nie wykonają. Role i kategorie domyślne muszą przyjść z migracji `SeedRoles` i `SeedDefaultCategories`, a ręczny indeks unikalny z `CategoryNameKey`. To jest właśnie sprawdzenie ścieżki produkcyjnej. Do zweryfikowania w planie: czy aplikacja przy `synchronize=false` nie zakłada czegoś, co dziś robią tylko seedery.

## Open Questions

1. ~~Mail flood (#6)~~ — rozstrzygnięte, patrz Decisions.
2. ~~Schemat w CI~~ — rozstrzygnięte: migracje, patrz Decisions.
3. **Obraz Postgresa.** Do potwierdzenia przy pierwszym przebiegu CI: ICU i `pl-PL-x-icu` w `postgres:16` oraz przyjęcie `C.UTF-8` przez initdb. Job ma to sprawdzać zapytaniem i odpadać.
4. **Zmienne środowiska w CI.** Zapisać `.env` w kroku joba czy polegać na `process.env` przez `loadEnv`. Precedencja niezweryfikowana.
5. **Zakres testów do dopisania (mały).** Wygasła lub wylogowana sesja na jednej trasie domenowej (dziś tylko `/auth/me`, ten sam guard). Wspólny pomocnik dwóch kont w `test/` jako wzorzec §6.4 dla tras po id z S-03. Ewentualnie polska kolejność własnych kategorii (sortowanie w JS, niezależne od bazy, więc niski sygnał).
