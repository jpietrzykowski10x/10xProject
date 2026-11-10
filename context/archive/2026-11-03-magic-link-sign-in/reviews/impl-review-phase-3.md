<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rejestracja i logowanie magic linkiem

- **Plan**: context/changes/magic-link-sign-in/plan.md
- **Scope**: Phase 3 of 5
- **Reviewed phases**: 3
- **Date**: 2026-11-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 8 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence

Kontrole automatyczne uruchomione 2026-11-04 na 33e0449:

- `npm test`: 94/94
- `npm run test:e2e`: 35/35, z atrapą `MAIL_TRANSPORT` w `auth.e2e-spec.ts`
- `npm run lint`: exit 0, 9 ostrzeżeń `unbound-method` w specach guardów z fazy 2
- `npm run build`: przechodzi
- `npm run migration:show`: 3 migracje zastosowane
- `npm run migration:generate -- Check`: exit 1 z „No changes in database schema were found”, czyli oczekiwany wynik

Kontrole ręczne:

- 3.6: migrację przeczytano ponownie w tym przeglądzie. Są indeksy unique na `email` i `token_hash` oraz 4 klucze obce, bez operacji poza zakresem.
- 3.7: dostarczenie maila na Gmaila jest zapisane w `fyi/todo-next.txt`. Tego nie da się sprawdzić w repozytorium.

Nie uruchamiano współbieżnych transakcji. Analiza blokad wynika z SQL i semantyki blokad PostgreSQL, przy założeniu READ COMMITTED.

## Findings

### F1 — Czas odpowiedzi request-link ujawnia, czy adres ma konto

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/auth/services/auth.service.ts:71
- **Detail**: Dla nieznanego adresu transakcja to sam `SELECT`, bez zapisów. Dla znanego dochodzą `DELETE`, `INSERT` i commit z zapisem WAL, a równoległe żądania czekają na blokadę wiersza. Brak limitów pozwala zebrać wiele próbek. `plan.md:23` wymaga, by odpowiedzi nie ujawniały istnienia konta, a `plan-brief.md:78` akceptuje tylko różnicę przy zakładaniu konta. Komentarz w `auth.service.ts:189` mówi wyłącznie o czasie SMTP. Różnicy nie zmierzono, nie wiadomo też, czy przetrwa jitter sieci i proxy. Każda próba na znany adres wysyła mail do właściciela, więc atak jest głośny. Z tego samego rozgałęzienia wynika też, że przy bazie odrzucającej zapisy znany adres dostaje 500, a nieznany 202.
- **Fix A ⭐ Recommended**: Zaakceptować ryzyko na MVP: dopisać je do Open Risks w `plan-brief.md`, poprawić komentarz w `auth.service.ts:189` i wiązać z limitem 60 s przed publicznym startem.
  - Strength: Spójne z decyzją o braku limitów na MVP; zapisuje ryzyko, którego decyzja dziś nie obejmuje.
  - Tradeoff: Sygnał czasowy zostaje do czasu limitu.
  - Confidence: MED — wielkość różnicy nie jest zmierzona.
  - Blind spot: Czy sygnał da się wykorzystać przez internet.
- **Fix B**: Odpowiadać 202 przed pracą na bazie i robić ją w tle.
  - Strength: Usuwa sygnał czasowy i różnice 500/202 z publicznych odpowiedzi.
  - Tradeoff: Awaria bazy też da 202, więc komunikat o niedostępności z fazy 4 nie zadziała dla tych tras; testy e2e potrzebują oczekiwania na efekt w tle.
  - Confidence: MED — większa zmiana w przepływie, tuż przed frontendem.
  - Blind spot: Sposób ponawiania i widoczność błędów pracy w tle.
- **Decision**: ACCEPTED via Fix A: ryzyko dopisane do Open Risks w plan-brief.md, komentarz w auth.service.ts poprawiony.

### F2 — Deadlock między verify a wystawieniem linku jest osiągalny

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/auth/services/auth.service.ts:84 oraz :161-174
- **Detail**: Otwarte pytanie z `## Follow-ups`. Wystarczy kolejność: verify blokuje token (`UPDATE`), wystawienie blokuje użytkownika (`FOR UPDATE`), `DELETE` czeka na token, a verify czeka na użytkownika. Dotyczy to też kont potwierdzonych, bo tam `FOR KEY SHARE` z klucza obcego przy `INSERT session` koliduje z `FOR UPDATE`. Okno to kilka zapytań (szacunek, bez pomiaru) dla jednego konta. Skutek to `500` po jednej stronie i spójne dane: jeśli przerwany jest verify, nie ma sesji, a użytkownik dostaje nowy link; jeśli wystawienie, nie ma nowego tokenu ani maila. Scenariusz nie został odtworzony na bazie. Dotyczy też S-09: `is_active` jest czytane bez blokady, więc verify mógłby utworzyć sesję tuż po dezaktywacji.
- **Fix A ⭐ Recommended**: Zostawić na MVP i przenieść do follow-upu S-09 z gotowym przepisem: odczyt `user_id` po hashu, blokada użytkownika osobnym zapytaniem, atomowy `UPDATE` tokenu, odczyt ról.
  - Strength: Bardzo rzadkie zdarzenie bez utraty spójności; S-09 i tak wymaga tej zmiany.
  - Tradeoff: Rzadki `500` zostaje do S-09.
  - Confidence: HIGH — wszystkie zapisy są w jednej transakcji, więc rollback jest kompletny.
  - Blind spot: Nie odtworzono scenariusza na żywej bazie.
- **Fix B**: Ujednolicić kolejność blokad teraz, przepisem z Fix A.
  - Strength: Zamyka pytanie i niespójność „każda porażka to 401” przed frontendem.
  - Tradeoff: Dodatkowe zapytanie przy każdym verify i przeróbka mocków w specu dla bardzo rzadkiego przypadku.
  - Confidence: MED — poprawność trzeba by potwierdzić testem współbieżnym.
  - Blind spot: Przy odczycie `user_id` przed blokadą brak tokenu nadal musi dawać ten sam 401.
- **Decision**: ACCEPTED via Fix A: zostaje na MVP, przepis na kolejność blokad w follow-upie S-09 w plan.md.

### F3 — Brak indeksów na user_id w magic_link_token i session

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/auth/entities/magic-link-token.entity.ts:18
- **Detail**: Każde wystawienie linku robi `DELETE ... WHERE user_id` bez indeksu, a zużyte tokeny nie znikają do S-05. Przy skali MVP to bez znaczenia. To samo wyszukiwanie będzie w „wyloguj wszędzie” z S-09. Migracje nie dotarły jeszcze na produkcję.
- **Fix**: Dodać `@Index` na obu kolumnach i osobną migrację z `migration:generate`.
- **Decision**: FIXED: @Index na user_id w obu encjach, migracja AddAuthUserIdIndexes zastosowana na subtracker-db.

### F4 — DTO przepuszczają wartości ponad limit

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/auth/dtos/request-link.dto.ts:8 oraz verify.dto.ts:4
- **Detail**: `MaxLength` sprawdza adres przed `normalizeEmail`, a `İ` po zmianie na małe litery się wydłuża. Adres o długości 252 znaków przeszedł walidację i po normalizacji miał 257, co na `varchar(254)` powinno dać 500 (nie uruchomiono tego na bazie). `VerifyDto.token` nie ma limitu długości, choć prawdziwy token ma 43 znaki; hashowanie długiego tekstu jest tanie, a limit ciała żądania wynosi 100 KB.
- **Fix**: Normalizować adres w transformacji DTO zamiast samego trim i dodać `@MaxLength(64)` do tokenu.
- **Decision**: FIXED: NormalizedEmail normalizuje adres przed walidacją, token ma @MaxLength(64), testy e2e dodane.

### F5 — Brak testu współbieżnego verify

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/test/auth.e2e-spec.ts:312
- **Detail**: Jednorazowość tokenu jest sprawdzana tylko po kolei. Współbieżnie testowany jest wyłącznie wyścig rejestracji (`:289`), więc gdyby atomowy `UPDATE` zastąpiono odczytem i zapisem, testy mogłyby tego nie wykryć.
- **Fix**: Dodać e2e z dwoma równoległymi `verify` tego samego tokenu: dokładnie jeden `200` i jeden `401`.
- **Decision**: FIXED: e2e z dwoma równoległymi verify (jeden 200, jeden 401, jedna sesja).

### F6 — Nieograniczona liczba wysyłek SMTP na publicznych trasach

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/auth/services/auth.service.ts:195 oraz src/mail/mail.transport.ts
- **Detail**: Każda prośba o link to osobna wysyłka w tle, bez limitu równoległości, a potem zapis audytu przez pulę 5 połączeń. `plan-brief.md:74` akceptuje zasypywanie skrzynek i reputację poczty, ale nie wyczerpanie procesu i puli.
- **Fix**: Dopisać to do ryzyka w `plan-brief.md`; `pool: true` i timeouty dodać razem z limitem wysyłki.
- **Decision**: ACCEPTED: dopisane do Open Risks w plan-brief.md; pool i timeouty razem z limitem wysyłki.

### F7 — Logi błędów 500 zawierają adres e-mail

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: globalny ExceptionsHandler Nest (backend-subtracker/src/main.ts)
- **Detail**: Symulowany `QueryFailedError` zalogowany przez `Logger` Nest pokazał `query` i `parameters`, więc adres lub user agent może trafić do `err.log`. Parametry zawierają tylko hashe, nigdy surowych tokenów.
- **Fix**: Zaakceptować na MVP albo dodać filtr logujący tylko komunikat i `code`.
- **Decision**: FIXED: SafeLoggingExceptionFilter przez APP_FILTER loguje komunikat i code oraz stack trace, wyłączany kluczem LOG_ERROR_STACKS (domyślnie true); parametry zapytań i treść żądań nigdy nie trafiają do logu, odpowiedzi bez zmian, testy unit i e2e dodane.

### F8 — Drobne odstępstwa od planu bez zapisu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Scope Discipline
- **Location**: backend-subtracker/src/auth/services/auth.service.ts:51-65, src/auth/dtos/verify.dto.ts:4, deploy/mydevil/README.md
- **Detail**: Żadne z tych odstępstw nie ma skutków funkcjonalnych ani nic nie ujawnia. (1) Nieaktywne, niepotwierdzone konto nie dostaje odświeżenia zgód; to zgodne z „tą samą logiką co requestLink”, a test to utrwala (`auth.service.spec.ts:273`). (2) Pusty lub nietekstowy token daje 400, a nie 401. (3) Nowy użytkownik ma zgody zapisane dwa razy w jednej transakcji. (4) `deploy/mydevil/README.md` dostał linię o PostgreSQL 16.10, której plan nie obejmuje.
- **Fix**: Dopisać te cztery punkty jedną notatką do `## Follow-ups` w planie; w kodzie bez zmian.
- **Decision**: FIXED: notatka w ## Follow-ups w plan.md, w kodzie bez zmian.

### F9 — Drobne niespójności nazewnictwa

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/auth/dtos/request-link.dto.ts:5, src/auth/mail-templates.ts:28
- **Detail**: `EMAIL_MAX_LENGTH` jest w DTO, a `user.entity.ts:17` ma dosłowne 254, choć inne encje eksportują swoje limity (`SESSION_USER_AGENT_MAX_LENGTH`). Temat maila to „Subtrackera”, a treść „SubTrackera”; temat ustalono wcześniej (`fyi/todo-next.txt`), więc rozstrzygnięcie pisowni należy do Ciebie.
- **Fix**: Przenieść stałą do encji; pisownię ujednolicić przy follow-upie o treści maili.
- **Decision**: FIXED: EMAIL_MAX_LENGTH przeniesione do user.entity.ts, temat maila to „Logowanie do SubTrackera”.
