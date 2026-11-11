# Ochrona CSRF w API — Plan Brief

> Full plan: `context/changes/csrf-protection/plan.md`

## What & Why

Obca strona może dziś automatycznym POST-em na `/auth/verify` z tokenem atakującego zalogować ofiarę na jego konto (login CSRF, F1 z przeglądu S-01), a ten sam brak dotyczy `/auth/logout` i przyszłych tras S-02. Włączamy wbudowaną ochronę Nesta przed żądaniami z obcych stron, zanim S-02 doda zapis subskrypcji. To bloker S-02 w roadmapie.

## Starting Point

`applyHttpSecurity` (`backend-subtracker/src/config/http-security.ts`) składa politykę HTTP dla `main.ts` i e2e: CORS i nagłówki bezpieczeństwa, bez CSRF. Testy auth tworzą aplikację bez tej polityki.

## Desired End State

Każdy `POST`/`PUT`/`PATCH`/`DELETE` wysłany przez przeglądarkę z obcej strony dostaje 403 przed kontrolerem. Frontend z `CORS_ORIGINS`, curl, health-check i SSR działają jak dotąd. Testy e2e pilnują obu kierunków, a wzorzec jest opisany jako sprawdzony na produkcji.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mechanizm | `app.enableCsrfProtection` z Nesta 12 | Wbudowane, oparte na `Sec-Fetch-Site`/`Origin`, chroni też przyszłe trasy. | Przegląd S-01 (F1) |
| Zaufane originy | całe `CORS_ORIGINS` | Jedna lista; `env.ts` pilnuje, że zawiera `FRONTEND_URL`, a frontend na innej subdomenie to `same-site`. | Plan |
| Miejsce | `applyHttpSecurity` | Produkcja i e2e dostają tę samą politykę. | Przegląd S-01 (F1) |
| Testy auth | też na `applyHttpSecurity` | Atak z F1 sprawdzony na prawdziwym `/auth/verify`. | Plan |
| Logowanie 403 | brak | Spójnie z decyzją F8 (4xx bez logu). | Plan |
| Dokumentacja | w tej zmianie, po teście na produkcji | Wzorzec trafia do szablonu już sprawdzony. | Plan |

## Scope

**In scope:**
- Ochrona CSRF w `applyHttpSecurity` z `trustedOrigins: CORS_ORIGINS`
- Testy e2e: obca strona → 403, frontend i curl → przechodzą, GET nieblokowany, atak F1 na `/auth/verify` odrzucony bez zużycia tokenu
- Deploy API i test na produkcji
- `backend-patterns.md`, roadmapa (bloker S-02), specyfikacja skilla 10.6

**Out of scope:**
- Tokeny CSRF, wyjątki tras, zmiany we frontendzie, logowanie odrzuceń

## Architecture / Approach

Nest sprawdza nagłówki w hooku żądania przed kontrolerami: bezpieczne metody przechodzą, `Sec-Fetch-Site` musi być `same-origin`/`none`, a bez niego `Origin` musi pasować do `Host`; origin z listy zaufanych przechodzi zawsze. Frontend na `subtracker.…` wysyła `same-site` z originem z `CORS_ORIGINS`, więc przechodzi; obca strona dostaje 403.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Ochrona CSRF i testy e2e | Ochrona w polityce HTTP, macierz testów e2e, testy auth na polityce produkcyjnej | Istniejące testy auth zmienią zachowanie po dodaniu polityki |
| 2. Wdrożenie i dokumentacja | Deploy API, test na produkcji, opis wzorca, zdjęty bloker S-02 | Prawdziwa przeglądarka wysyła inne nagłówki niż zakładamy |

**Prerequisites:** lokalny PostgreSQL i `.env` dla e2e; push i merge po stronie użytkownika.
**Estimated effort:** jedna krótka sesja; faza 2 to głównie deploy i testy ręczne.

## Open Risks & Assumptions

- Zakładamy, że MyDevil nie zmienia nagłówka `Host` w sposób, który psułby porównanie z `Origin`; dla frontendu i tak decyduje `trustedOrigins`, a test 2.4 to potwierdzi.
- Wycofanie: `rollback.sh api` (bez zmian w bazie).

## Success Criteria (Summary)

- Sfałszowany POST z obcej strony dostaje 403 lokalnie i na produkcji.
- Logowanie, „Zaloguj” i „Wyloguj” z prawdziwego frontendu działają bez 403.
- Wzorzec opisany jako sprawdzony; S-02 nie ma już blokera CSRF.
