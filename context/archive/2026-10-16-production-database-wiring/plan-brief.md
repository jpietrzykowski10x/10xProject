# Produkcyjna baza i połączenie frontend → API — Plan Brief

> Full plan: `context/changes/production-database-wiring/plan.md`

## What & Why

Fundament F-01 z roadmapy: backend dostaje PostgreSQL przez TypeORM (lokalnie i na MyDevil), migracje uruchamiane bezpiecznie w deployu oraz CORS gotowy pod ciasteczko sesji. Bez tego ani logowanie (S-01), ani pierwsza subskrypcja na liście (S-02, gwiazda przewodnia) nie mają gdzie zapisywać danych i nie da się ich sprawdzić na produkcji.

## Starting Point

Obie aplikacje działają na MyDevil jako „Hello World” z deployem przez GitHub Actions (wydania obok siebie, `mv`, health-check z auto-przywróceniem). `deploy.sh` ma zarezerwowane miejsce na kopię bazy i migracje przed zamianą. Backend nie ma ORM, konfiguracji env ani CORS; frontend nie ma `HttpClient` ani adresu API. Lokalnie nie ma PostgreSQL.

## Desired End State

`/health` na produkcji odpowiada `{"status":"ok","db":"ok"}` (503 przy awarii bazy), a strona główna frontendu pokazuje w przeglądarce status API pobrany z drugiej subdomeny z credentials. Każdy deploy API zatrzymuje usługę, robi kopię bazy i uruchamia migracje jako jawny krok, zanim podmieni wersję. Błąd migracji albo health-checku przywraca bazę i kod do stanu sprzed deployu.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| ORM | TypeORM w NestJS | Wybór z `tech-stack.md`, potwierdzony przez użytkownika. | Plan |
| Bazy | Lokalnie `subtracker-db-dev` (praca, `synchronize` przy `MODE=DEV`) + `subtracker-db` (referencja dla `migration:generate`, zmieniana tylko migracjami); na MyDevil jedna baza (`MODE=PROD`) | Model z innych projektów użytkownika (`fyi/app.module.ts`): szybka iteracja na encjach, migracje generowane raz na koniec funkcji. | User |
| Klucze env | `MODE`, `POSTGRES_*`, `POSTGRES_DATABASE_DEV`, `DATABASE_AUTO_SYNCHRONIZATION`, `APPLICATION_NAME` | Nazwy jak w projektach użytkownika; dodana walidacja (`PROD` + auto-sync = błąd). | User |
| Konfiguracja | `.env` (dev) i `.env.mydevil` (wzór `shared/.env`) poza gitem, `.env.example` w repo | Zgodne z dotychczasowym zwyczajem użytkownika i z zasadą, że sekrety nie jadą w paczce ani w CI. | Plan |
| Migracje na produkcji | Jawny krok `deploy.sh` z przestojem: stop API → `pg_dump -Fc` → `migration:run` (jedna transakcja) → `mv` → `/health`; nieudany health-check → `restore-db.sh` + stara wersja | Pewność spójności danych ważniejsza niż ok. minuta dostępności; `migration:revert` bywa zawodny, przywrócenie z kopii nie. | User |
| Rollback API | `rollback.sh api` cofa kod i przywraca bazę z kopii sprzed deployu cofanego wydania (`.deploy-info`), po potwierdzeniu | Stary kod nigdy nie działa na nowym schemacie; świadomie płacimy utratą danych od deployu. | User |
| Migracja `Init` | Pusta migracja w F-01 | Pierwszy deploy przećwiczy pełną ścieżkę migracji, zamiast czekać na S-01. | User |
| Tabela historii i uuid | `migration_history`; `gen_random_uuid()` (`uuidExtension: 'pgcrypto'`) zamiast `uuid-ossp` | Nazwa jak u użytkownika; brak zależności od rozszerzenia, którego zwykły użytkownik MyDevil może nie móc założyć przy przywracaniu. | Plan |
| Dowód frontend → API | Status API na stronie, pobierany w przeglądarce z credentials | Sprawdza dokładnie ścieżkę, której użyje S-01 (CORS, adres API, baza). | Plan |
| CORS | `CORS_ORIGINS` (lista po przecinku) w env, `credentials: true`, `*` odrzucane | Parametryzowalne per środowisko i gotowe pod ciasteczko sesji. | Plan |
| Health-check API w deployu | `/health` z `SELECT 1` zamiast `/` | Brak połączenia z bazą automatycznie cofa deploy. | Plan |
| Pula połączeń | `POSTGRES_POOL_MAX`, domyślnie 5 | Współdzielony serwer bazy MyDevil (`infrastructure.md`). | Research (infrastructure.md) |

## Scope

**In scope:**
- TypeORM + `pg` + moduł konfiguracji z walidacją env, źródło danych dla CLI, skrypty migracji
- `GET /health` sprawdzający bazę, CORS z `CORS_ORIGINS` + credentials
- Adres API per środowisko i komponent statusu API na froncie
- Kopia bazy + migracje + health-check `/health` w `deploy.sh`, README serwera, komendy w CLAUDE.md

**Out of scope:**
- Encje i tabele domenowe, ciasteczko sesji (S-01)
- `migration:revert` na produkcji (zamiast tego kopia), `.env.mydevil` przez CI, e2e w CI, monitoring, Docker

## Architecture / Approach

```
przeglądarka ──GET /health (credentials)──► API (NestJS, CORS_ORIGINS) ──SELECT 1──► PostgreSQL
                                                   ▲
deploy.sh (api): npm ci → stop API → pg_dump -Fc → migration:run (TypeORM CLI z nowej paczki) → mv → start → /health
                 (błąd health-checku → restore-db.sh + poprzednie wydanie)
```

Jedna funkcja opcji połączenia jest współdzielona przez moduł Nesta i `DataSource` dla CLI, więc migracje łączą się tak samo jak aplikacja.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend: TypeORM, konfiguracja, `/health`, CORS | Backend z bazą i CORS, zweryfikowany lokalnie | TypeORM CLI może nie załadować ESM `data-source.js` (wtedy mały skrypt zastępczy) |
| 2. Frontend: adres API i status na stronie | Strona pokazuje status API z przeglądarki | Prerender nie może wołać API — wywołanie dopiero po renderze |
| 3. Deploy: przestój, kopia, migracje, przywracanie | Produkcja z bazą; każdy deploy API: stop → kopia → migracje → start → `/health`, z automatycznym przywróceniem bazy i kodu | Ręczne kroki na serwerze (baza, `shared/.env`, wgranie `deploy.sh`, `restore-db.sh` i `rollback.sh`) muszą być przed pushem |

**Prerequisites:** lokalny PostgreSQL z bazami `subtracker-db` i `subtracker-db-dev` (rola `subtracker-adm`); dostęp SSH do MyDevil; `pg_dump`/`psql` na serwerze.
**Estimated effort:** ~2–3 sesje po godzinach w 3 fazach (Faza 3 w większości to bramki ręczne).

## Open Risks & Assumptions

- Deploy API ma ok. 30–60 s przestoju; zadania cykliczne (od S-06) muszą nadrabiać pominięte uruchomienia.
- Przywracanie czyści schemat `public`, więc wymaga, żeby użytkownik MyDevil był jego właścicielem (bramka 3.3); ćwiczone raz na pustej bazie (3.11).
- `rollback.sh api` cofa kod razem z bazą (kopia sprzed deployu cofanego wydania, wskazana w `.deploy-info`) i po potwierdzeniu traci dane zapisane od tamtego deployu.
- Wersja `pg_dump` na MyDevil musi być zgodna z wersją serwera bazy (sprawdzane w bramce 3.3).

## Success Criteria (Summary)

- `https://apisubtracker.jakubpietrzykowski.pl/health` → `{"status":"ok","db":"ok"}`, a obcy origin nie dostaje nagłówków CORS.
- `https://subtracker.jakubpietrzykowski.pl` pokazuje „API i baza działają”, bez błędów CORS.
- Deploy API tworzy kopię bazy w `backups/` i tabelę `migration_history`; błąd migracji albo health-checku zostawia bazę i kod w stanie sprzed deployu.
