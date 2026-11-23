# Kontekst żądania i przyczyny odmów w logu API — Plan Brief

> Full plan: `context/changes/request-context-and-denial-reasons/plan.md`

## What & Why

Gdy na produkcji coś nie działa, log API ma powiedzieć, które żądanie padło, u kogo i dlaczego, bez danych osobowych w pliku. Dziś linia 500 nie ma trasy, użytkownika ani id żądania, a każda odmowa 4xx jest z założenia niewidoczna. Przez to systemowa usterka (rozjazd zegara przy linkach, zła lista `CORS_ORIGINS`, rozjazd walidacji frontu i API) wygląda jak pomyłki użytkowników. Realizuje FR-021 i S-13, a zamyka L1 (krytyczne) z audytu obserwowalności.

## Starting Point

Wszystkie błędy przechodzą przez globalny `SafeLoggingExceptionFilter`, który przepuszcza `HttpException` bez logu i loguje 5xx bez kontekstu. W kodzie nie ma middleware ani id żądania. `verify` daje jedno 401 dla trzech przyczyn, a `authenticate` zwraca `null` bez przyczyny. CSRF Nesta da się rozpoznać tylko po komunikacie.

## Desired End State

Każda odpowiedź ma `X-Request-Id`, a linia 5xx ma metodę, szablon trasy, użytkownika i to samo id. Wybrane odmowy zostawiają jedną linię `warn` z kodem przyczyny, identyfikatorami (uuid) i nazwami pól, w limicie 10 na kod na minutę. Odmowy te to: weryfikacja linku, sesja na trasach chronionych, CSRF, rola i ranga admina oraz walidacja. W żadnej linii nie ma adresu, tokenu, ciasteczka, query ani wartości pól. Odpowiedzi HTTP pozostają bez zmian (poza P5).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Limit linii odmów | Per kod, okno 1 min, najwyżej 10, potem „suppressed N” | Zalew jednego kodu (np. skaner i CSRF) nie zagłusza innego, a log ma górną granicę. |
| Weryfikacja linku | Rozróżniać `link_unknown/used/expired/user_missing/race/account_blocked` z id tokenu | Skok `link_expired` zdradza rozjazd zegara, `link_unknown` to skaner, a to jest sedno L1. |
| Sesja | Logować tylko 401 guarda na trasach chronionych; `/auth/session` bez logu | Regresja wylogowująca widoczna jako skok `session_unknown`, a zwykły gość nic nie pisze. |
| Id żądania | Własny UUID w middleware, nagłówek `X-Request-Id`, przychodzący ignorowany | Operator dostaje id z odpowiedzi, a klient nie wstrzyknie do logu własnej wartości. |
| Dodatki z audytu | P12 (5xx `HttpException` z logiem), P5 (`@CurrentUser()` bez użytkownika → 500), L1 (ważność linku liczona w bazie) | Ten sam kod; L1 usuwa przyczynę, którą nowe linie mają wykrywać. |
| Nośnik przyczyny | Opis odmowy dopięty do wyjątku (`withDenial`), linie pisze tylko filtr | `shared/` zostaje bez wiedzy o domenie, body odpowiedzi bez zmian, filtr działa po wycofaniu transakcji. |
| CSRF | Rozpoznanie po dwóch stałych komunikatach Nesta, w linii origin strony | Nest nie daje hooka; test e2e pilnuje tekstów przy aktualizacji Nesta. |

## Scope

**In scope:**
- middleware id żądania;
- CORS `exposedHeaders`;
- kontekst w liniach 5xx;
- limiter w `shared/rate-limit/`;
- `withDenial` w `shared/logging/`;
- linie odmów w filtrze;
- kody dla CSRF, walidacji (podklasa `ValidationPipe`), `RolesGuard`, rangi admina, `verify` i guarda sesji;
- P5, P12, L1;
- `backend-patterns.md` i `CLAUDE.md`.

**Out of scope:**
- access log, format JSON i wersja w logu (S-14);
- raporty z przeglądarki i SSR (S-15);
- wiersz `DENIED` w `admin_audit` (S-16);
- logowanie 404, 409, `ParseUUIDPipe` i `/auth/session`;
- przyjmowanie przychodzącego id;
- trwały limit i alarmy z linii odmów.

## Architecture / Approach

`applyHttpSecurity` zaczyna od `app.use(assignRequestId)`, więc id ma każde żądanie przed CORS i CSRF, w `main.ts` i w e2e. Moduły oznaczają wyjątek przyczyną (`withDenial(new UnauthorizedException(), { code, ids })`) tam, gdzie ją znają. Filtr jako jedyny pisze linie: `error` dla 5xx z `describeRequest`, a `warn` w kontekście `Denials` dla oznaczonych 4xx i CSRF, przez `FixedWindowLimiter`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Kontekst żądania i błędy 5xx | `X-Request-Id`, linia 5xx z metodą, trasą, użytkownikiem i id; P12, P5 | Middleware musi stać przed CSRF, inaczej linie CSRF nie mają id |
| 2. Mechanizm odmów i odmowy przekrojowe | Limiter, `withDenial`, linie CSRF, walidacji, roli i rangi | Body walidacji musi zostać identyczne; teksty CSRF Nesta mogą się zmienić |
| 3. Przyczyny logowania i sesji | Kody `link_*` i `session_*`, ważność linku w bazie | Dodatkowe zapytanie w transakcji `verify`; kolejność przyczyn sesji |
| 4. Dokumentacja i produkcja | Wzorce, `CLAUDE.md`, sprawdzenie na serwerze | Brak (sprawdzenia ręczne) |

**Prerequisites:** S-11 zarchiwizowane (jest); lokalna baza i `.env` do e2e.
**Estimated effort:** ok. 2–3 sesje w 4 fazach; bez migracji.

## Open Risks & Assumptions

- Teksty odrzucenia CSRF w Nest 12 są stałe w `cross-origin-protection.js`. Zmiana przy aktualizacji Nesta wyłączy linie `csrf_*` bez błędu, a pilnuje tego tylko test e2e.
- Limit jest w pamięci procesu: restart go zeruje, a licznik pominiętych z ostatniego okna kodu, który potem ucichł, może przepaść (przyjęte).
- Dane od klienta w liniach to tylko origin w CSRF (`URL.origin`, najwyżej 100 znaków) i nazwy pól spoza DTO w kształcie identyfikatora (`^[a-zA-Z][a-zA-Z0-9]{0,39}$`, reszta jako `unknown=N`). Ciąg typu „jankowalski” nadal przejdzie jako nazwa pola (przyjęte).
- Limit sprawdza tylko test jednostkowy, bo filtr żyje przez cały plik e2e.
- Klasyfikacja `verify` czyta token bez blokady po nieudanym zapytaniu, więc kod opisuje chwilę odczytu.

## Success Criteria (Summary)

- Zgłoszenie „o 10:03 nie działało” da się dopasować do linii po id żądania z odpowiedzi albo po trasie i użytkowniku.
- Rozjazd zegara przy linkach, zła lista `CORS_ORIGINS` albo regresja sesji widać w logu jako skok konkretnego kodu, bez adresów i tokenów.
- Test e2e każdej rodziny odmów sprawdza kod i brak adresu, tokenu, ciasteczka i query.
