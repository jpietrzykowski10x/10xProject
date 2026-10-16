# Produkcyjna baza i połączenie frontend → API — Plan Brief

> Full plan: `context/changes/production-database-wiring/plan.md`

## What & Why

Fundament F-01 z roadmapy: backend dostaje PostgreSQL przez TypeORM (lokalnie i na MyDevil), migracje uruchamiane bezpiecznie w deployu oraz CORS gotowy pod ciasteczko sesji. Bez tego ani logowanie (S-01), ani pierwsza subskrypcja na liście (S-02, gwiazda przewodnia) nie mają gdzie zapisywać danych i nie da się ich sprawdzić na produkcji.

## Starting Point

Obie aplikacje działają na MyDevil jako „Hello World” z deployem przez GitHub Actions (wydania obok siebie, `mv`, health-check z auto-przywróceniem). `deploy.sh` ma zarezerwowane miejsce na kopię bazy i migracje przed zamianą. Backend nie ma ORM, konfiguracji env ani CORS; frontend nie ma `HttpClient` ani adresu API. Lokalnie nie ma PostgreSQL.

## Desired End State

`/health` na produkcji odpowiada `{"status":"ok","db":"ok"}` (503 przy awarii bazy), a strona główna frontendu pokazuje w przeglądarce status API pobrany z drugiej subdomeny z credentials. Każdy deploy API robi kopię bazy i migracje, zanim podmieni wersję; błąd zostawia starą wersję nietkniętą.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| ORM | TypeORM w NestJS | Wybór z `tech-stack.md`, potwierdzony przez użytkownika. | Plan |
| Bazy | Lokalny PostgreSQL (dev) + baza na MyDevil (prod) | Ta sama baza co produkcja, bez Dockera. | Plan |
| Konfiguracja | `.env` (dev) i `.env.mydevil` (wzór `shared/.env`) poza gitem, `.env.example` w repo | Zgodne z dotychczasowym zwyczajem użytkownika i z zasadą, że sekrety nie jadą w paczce ani w CI. | Plan |
| Migracje na produkcji | W `deploy.sh`: `pg_dump` → migracje → `mv` | Błąd migracji nie dotyka działającej wersji, a kopia jest zawsze przed zmianą schematu. | Plan |
| Dowód frontend → API | Status API na stronie, pobierany w przeglądarce z credentials | Sprawdza dokładnie ścieżkę, której użyje S-01 (CORS, adres API, baza). | Plan |
| CORS | `CORS_ORIGINS` (lista po przecinku) w env, `credentials: true`, `*` odrzucane | Parametryzowalne per środowisko i gotowe pod ciasteczko sesji. | Plan |
| Health-check API w deployu | `/health` z `SELECT 1` zamiast `/` | Brak połączenia z bazą automatycznie cofa deploy. | Plan |
| Pula połączeń | `DB_POOL_MAX`, domyślnie 5 | Współdzielony serwer bazy MyDevil (`infrastructure.md`). | Research (infrastructure.md) |

## Scope

**In scope:**
- TypeORM + `pg` + moduł konfiguracji z walidacją env, źródło danych dla CLI, skrypty migracji
- `GET /health` sprawdzający bazę, CORS z `CORS_ORIGINS` + credentials
- Adres API per środowisko i komponent statusu API na froncie
- Kopia bazy + migracje + health-check `/health` w `deploy.sh`, README serwera, komendy w CLAUDE.md

**Out of scope:**
- Encje i tabele domenowe, ciasteczko sesji (S-01)
- Cofanie migracji przy rollbacku, `.env.mydevil` przez CI, e2e w CI, monitoring, Docker

## Architecture / Approach

```
przeglądarka ──GET /health (credentials)──► API (NestJS, CORS_ORIGINS) ──SELECT 1──► PostgreSQL
                                                   ▲
deploy.sh (api): npm ci → pg_dump → migracje (TypeORM CLI z nowej paczki) → mv → health-check /health
```

Jedna funkcja opcji połączenia jest współdzielona przez moduł Nesta i `DataSource` dla CLI, więc migracje łączą się tak samo jak aplikacja.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend: TypeORM, konfiguracja, `/health`, CORS | Backend z bazą i CORS, zweryfikowany lokalnie | TypeORM CLI może nie załadować ESM `data-source.js` (wtedy mały skrypt zastępczy) |
| 2. Frontend: adres API i status na stronie | Strona pokazuje status API z przeglądarki | Prerender nie może wołać API — wywołanie dopiero po renderze |
| 3. Deploy: kopia, migracje, health-check | Produkcja z bazą, migracjami i kopią przed każdym deployem | Ręczne kroki na serwerze (baza, `shared/.env`, wgranie `deploy.sh`) muszą być przed pushem |

**Prerequisites:** lokalny PostgreSQL z bazą `subtracker`; dostęp SSH do MyDevil; `pg_dump`/`psql` na serwerze.
**Estimated effort:** ~2–3 sesje po godzinach w 3 fazach (Faza 3 w większości to bramki ręczne).

## Open Risks & Assumptions

- Migracje biegną, gdy stara wersja działa — od teraz muszą być addytywne.
- `rollback.sh` cofa tylko kod; przywrócenie bazy to ręczne odtworzenie z `backups/`.
- Wersja `pg_dump` na MyDevil musi być zgodna z wersją serwera bazy (sprawdzane w bramce 3.3).

## Success Criteria (Summary)

- `https://apisubtracker.jakubpietrzykowski.pl/health` → `{"status":"ok","db":"ok"}`, a obcy origin nie dostaje nagłówków CORS.
- `https://subtracker.jakubpietrzykowski.pl` pokazuje „API i baza działają”, bez błędów CORS.
- Deploy API tworzy kopię bazy w `backups/` i tabelę `migrations`; błąd migracji nie zatrzymuje działającej wersji.
