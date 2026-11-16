# Automatyczny cykl życia subskrypcji (S-05) — plan implementacji

## Overview

Użytkownik anuluje subskrypcję jedną akcją w wierszu listy (subskrypcja trafia do „W trakcie anulowania”) i może to anulowanie cofnąć przed końcem okresu. System raz dziennie, a dodatkowo przy każdym starcie procesu API, sam przenosi subskrypcje: `trial → active` po dacie końca triala, `cancelled_pending → cancelled` po dacie rozliczenia, a subskrypcjom `active` z datą rozliczenia w przeszłości przesuwa tę datę o cykl. Ten sam scheduler sprząta wygasłe tokeny logowania i stare sesje (follow-up z S-01). Edycja subskrypcji zostaje pełną ręczną korektą: status i daty da się w niej ustawić dowolnie (FR-005), np. po zawieszeniu usługi i wznowieniu z innymi datami. FR-013, roadmapa S-05.

## Current State Analysis

- `status` to `varchar(32)` z enumem TS (`subscription.types.ts:2-7`). `POST` i `PUT` przyjmują każdy z 4 statusów jednym DTO (`dtos/create-subscription.dto.ts:78-79`). Nie ma akcji „anuluj”; dialog usuwania odsyła do zmiany statusu w edycji (`delete-subscription-dialog.html:7-11`).
- Brak schedulera (`@nestjs/schedule` nie ma w `package.json`, `app.module.ts:16-48` go nie importuje) i brak pojęcia „dziś” po stronie backendu; nigdzie nie ustawiono strefy czasowej (`config/env.ts`, `database.options.ts`, `deploy/mydevil/start-app.sh`).
- Daty to `date` jako string `YYYY-MM-DD`: `trial_end_date` NULL poza trialem, `next_billing_date` NOT NULL (`subscription.entity.ts:62-66`). Indeksy tylko na `user_id` i `category_id` (migracja `1794406389791-SubscriptionsSchema.ts:17,20`).
- Proces API to jedna instancja `forever`; deploy zatrzymuje go na 30–60 s, MyDevil może go zrestartować w dowolnej chwili; rollback przywraca dump sprzed deployu (`deploy/mydevil/README.md:75-97`).
- `magic_link_token` i `session` mają `expires_at` (tokeny 15 min, sesje 30 dni, `auth/auth.constants.ts:4-5`), sesja też `revoked_at`; nic ich nie usuwa.
- Testy e2e biegną plik po pliku (`vitest.config.e2e.ts`, `fileParallelism: false`) na jednej bazie dev, każdy plik sprząta swoje dane.

## Desired End State

- `POST /subscriptions/:id/cancel` (sesja): `active` → `cancelled_pending` (daty bez zmian); `trial` → `cancelled_pending` z `nextBillingDate := trialEndDate` i `trialEndDate := null` (anulowany trial kończy się z końcem triala, bez płatności). Odpowiedź 200 z `SubscriptionResponse`.
- `POST /subscriptions/:id/resume` (sesja): `cancelled_pending` → `active` (daty bez zmian). 200 z `SubscriptionResponse`.
- Obie trasy: cudze lub nieistniejące id → 404 (ten sam komunikat co `PUT`/`DELETE`), id spoza UUID → 400, subskrypcja w stanie, z którego przejście nie istnieje → 409.
- `PUT /subscriptions/:id` bez zmian kontraktu: dowolny status i daty według reguł z S-02.
- Job cyklu życia, „dziś” = dzień kalendarzowy w `Europe/Warsaw`, przejście w dniu **po** dacie (`data < dziś`):
  1. `trial` z `trial_end_date < dziś` → `active`, `trial_end_date := null`;
  2. `cancelled_pending` z `next_billing_date < dziś` → `cancelled`;
  3. `active` z `next_billing_date < dziś` → `next_billing_date` przesunięte o 1 miesiąc / 1 rok tyle razy, aż będzie ≥ dziś (dzień przycinany do końca miesiąca: 31.01 → 28.02).
  Kolejność 1 → 2 → 3 w jednym przebiegu, więc trial zamieniony dziś w `active` dostaje też przesuniętą datę.
- Przykład (dziś = 2026-11-20): trial z końcem 2026-11-19 i rozliczeniem 2026-11-19, cykl miesięczny → `active`, trial `null`, rozliczenie 2026-12-19. Trial z końcem 2026-11-20 → bez zmian. `cancelled_pending` z rozliczeniem 2026-11-19 → `cancelled` (znika z sum). `active` roczna z rozliczeniem 2024-03-10 → 2027-03-10. `active` miesięczna z rozliczeniem 2026-01-31 → 2026-11-30.
- Job biegnie codziennie o 00:05 `Europe/Warsaw` oraz raz przy starcie aplikacji (nadrabia okno deployu i restartu). Jest idempotentny: drugi przebieg tego samego dnia nic nie zmienia. Każdy przebieg ze zmianami loguje liczby przejść; błąd jest logowany i nie zatrzymuje procesu.
- Job sprzątający (ten sam harmonogram) usuwa `magic_link_token` z `expires_at` starszym niż 7 dni oraz `session` z `expires_at` albo `revoked_at` starszym niż 7 dni.
- Lista: w wierszu `active`/`trial` akcja „Anuluj subskrypcję” (dialog potwierdzenia), w wierszu `cancelled_pending` akcja „Przywróć” (bez dialogu), w wierszu `cancelled` żadnej z nich. Po akcji lista i sumy odświeżają się, komunikat w regionie na żywo.

### Key Discoveries:

- Wzorzec warunkowego zapisu i 404: `subscriptions.service.ts:138-160` (`update({ id, userId })`, nie `save()`).
- Rejestr tras i test dwóch kont: `test/routes.e2e-spec.ts:36-64`, `test-plan.md` §6.4; lista tras bez sesji: `test/subscriptions/access.e2e-spec.ts`.
- Wzorzec dialogu z akcją: `delete-subscription-dialog.ts:30-98` i obsługa na stronie `pages/subscriptions/subscriptions.ts:256-278`; tabela tylko emituje akcje (`subscription-table.ts:50-51`).
- `ValidationPipe` z `forbidNonWhitelisted` jest globalny (`app.module.ts:39-45`); nowe trasy bez ciała nie potrzebują DTO.
- `COUNTED_STATUSES` (`cost-totals.ts:14-18`): `cancelled_pending → cancelled` zdejmuje subskrypcję z sum, pozostałe przejścia ich nie zmieniają.
- `@nestjs/schedule` 12.x ma peer `@nestjs/common|core ^11 || ^12`.

## What We're NOT Doing

- Nie ograniczamy edycji: `PUT` dalej przyjmuje dowolny status i daty (ręczna korekta, np. zawieszenie i wznowienie z innymi datami). Ręczna zmiana trialu na `cancelled_pending` w formularzu nie przestawia daty rozliczenia — daty ustawia użytkownik.
- Brak statusu „zawieszona” i brak wznawiania `cancelled` akcją (tylko przez edycję).
- Brak kolumny historii przejść, `updated_at` i znacznika wykonania joba — przejścia są idempotentne same z siebie (warunek na status i datę w `UPDATE`).
- Brak przypomnień e-mail (S-06) i strefy czasowej per użytkownik.
- Brak blokady joba między procesami (jedna instancja API, `start-app.sh` zatrzymuje poprzednią przed startem).
- Brak monitoringu/alertów joba poza logiem.
- Bez zachowania „dnia kotwicy” przy przesuwaniu daty: 31.01 → 28.02 → 28.03 (dryf końca miesiąca akceptujemy).

## Implementation Approach

Backend najpierw, front na końcu. Każda zmiana stanu to jedno warunkowe `UPDATE … WHERE id, user_id, status IN (…)` (akcje) albo `UPDATE … WHERE status = … AND data < :today` (job), więc akcja użytkownika i job nie nadpisują się nawzajem i nie potrzebują blokad. Reguły przejść to czyste funkcje w module `subscriptions` (testowane jednostkowo ze wstrzykniętym „dziś”); ogólne funkcje dnia (dziś w strefie, dodanie miesięcy z przycięciem) trafiają do `src/shared/date/` z testami obok. Scheduler wywołuje serwisy z dniem wyliczonym w `Europe/Warsaw` i nie zawiera logiki.

## Critical Implementation Details

- **Przebieg przy starcie jest awaitowany w `onApplicationBootstrap`, z `try/catch`.** Dzięki temu w e2e kończy się przed pierwszym żądaniem testu (brak wyścigu z danymi tworzonymi przez test), a błąd bazy nie blokuje startu ani health-checku deployu.
- **Testy e2e joba używają prawdziwego „dziś” i dat względem niego** (wczoraj, dziś), nigdy daty z daleka w przyszłości: job działa na całej bazie dev, więc „dziś” = 2030 przestawiłoby też dane ręcznych testów w `subtracker-db-dev`. Logikę dat z dowolnym „dziś” pokrywają testy jednostkowe.
- **Edycja otwarta dla subskrypcji, którą właśnie anulowano lub przywrócono, zamyka się** (jak po usunięciu): formularz trzyma stary status i zapis cofnąłby akcję.

## Faza 1: API — anuluj i przywróć

### Overview

Dwie nowe trasy akcji z regułami przejść użytkownika, testy jednostkowe reguł i testy e2e (404/409/400, dwa konta, rejestr tras).

### Changes Required:

#### 1. Reguły przejść użytkownika

**File**: `backend-subtracker/src/subscriptions/subscription-lifecycle.ts` (nowy) + `subscription-lifecycle.spec.ts`

**Intent**: Jedno miejsce z listami statusów, z których wolno anulować (`trial`, `active`) i przywrócić (`cancelled_pending`), oraz statusem docelowym każdej akcji. Faza 2 dopisze tu reguły joba.

**Contract**: eksportowane stałe `CANCELLABLE_STATUSES`, `RESUMABLE_STATUSES` (tablice `SubscriptionStatus`); test sprawdza dokładne listy, jak `cost-totals.spec.ts` dla `COUNTED_STATUSES`.

#### 2. Serwis i kontroler

**File**: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts`, `controllers/subscriptions.controller.ts`

**Intent**: `cancel(userId, id)` i `resume(userId, id)` wykonują jedno warunkowe `UPDATE` ograniczone do konta i dozwolonych statusów; anulowanie triala w tym samym zapytaniu przenosi `trial_end_date` do `next_billing_date` i zeruje `trial_end_date`. Gdy `UPDATE` nic nie zmienił: brak wiersza konta → 404 (`NOT_FOUND_MESSAGE`), wiersz w innym stanie → 409. Odpowiedź czyta wiersz ponownie z kategorią.

**Contract**: `POST /subscriptions/:id/cancel`, `POST /subscriptions/:id/resume`, `@Param('id', ParseUUIDPipe)`, `@HttpCode(200)`, bez ciała; zwracają `SubscriptionResponse`. Zmiana przy anulowaniu: `SET status = 'cancelled_pending', next_billing_date = COALESCE(trial_end_date, next_billing_date), trial_end_date = NULL`.

#### 3. Testy e2e

**File**: `backend-subtracker/test/subscriptions/subscription-actions.e2e-spec.ts` (nowy), `test/routes.e2e-spec.ts`, `test/subscriptions/access.e2e-spec.ts`, `test/subscriptions/subscriptions-e2e.ts`

**Intent**: Przypadki: anulowanie `active` (daty bez zmian), anulowanie `trial` (rozliczenie = dawny koniec triala, `trialEndDate: null`), przywrócenie `cancelled_pending`, 409 dla anulowania `cancelled`/`cancelled_pending` i przywrócenia `active`/`trial`/`cancelled`, 404 dla nieznanego id, 400 dla id spoza UUID, sumy po anulowaniu dalej liczą subskrypcję. Test dwóch kont: `other` dostaje 404 na obu trasach, a subskrypcja `owner` jest nietknięta. Obie trasy w `EXPECTED_ROUTES` (z `twoAccountTest`) i w liście `access.e2e-spec.ts`.

**Contract**: prefiks pliku `e2e-subscriptions-actions-` (nie jest początkiem żadnego innego prefiksu); żądania akcji jako pomocnicy w `subscriptions-e2e.ts`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe backendu przechodzą: `cd backend-subtracker && npm test`
- Lint przechodzi: `cd backend-subtracker && npm run lint`
- Build przechodzi: `cd backend-subtracker && npm run build`
- Testy e2e API przechodzą, w tym nowy plik akcji i rejestr tras: `cd backend-subtracker && npm run test:e2e`

#### Manual Verification:

- Na `start:dev` z sesją z `dev-local/test-session.mjs`: `POST …/cancel` na trialu zwraca 200 z datą rozliczenia równą dawnemu końcowi triala, ponowne `cancel` zwraca 409

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 2: Scheduler i job cyklu życia

### Overview

`@nestjs/schedule`, „dziś” w `Europe/Warsaw`, trzy przejścia joba, przebieg przy starcie i codzienny cron, indeksy pod zapytania joba.

### Changes Required:

#### 1. Zależność i moduł

**File**: `backend-subtracker/package.json`, `src/app.module.ts`

**Intent**: Dodać `@nestjs/schedule` (wersja 12.x opublikowana co najmniej 2 tygodnie temu) i `ScheduleModule.forRoot()`.

**Contract**: nowa zależność produkcyjna; `npm ci --omit=dev` na FreeBSD musi ją zainstalować (czysty JS, bez modułów natywnych).

#### 2. Funkcje dnia w `shared/`

**File**: `backend-subtracker/src/shared/date/calendar-day.ts` (nowy) + `calendar-day.spec.ts`

**Intent**: Ogólne helpery bez wiedzy o domenie: dzień kalendarzowy w danej strefie dla danej chwili oraz dodanie N miesięcy do dnia `YYYY-MM-DD` z przycięciem do ostatniego dnia miesiąca. Stała strefy aplikacji `APP_TIME_ZONE = 'Europe/Warsaw'`.

**Contract**: `calendarDayIn(timeZone: string, at: Date): string` (przez `Intl.DateTimeFormat`, nie przez strefę procesu); `addMonthsClamped(day: string, months: number): string`. Testy: 23:30 UTC 2026-03-28 → `2026-03-29` w Warszawie, chwile wokół zmiany czasu (marzec, październik), 31.01 + 1 → 28.02, 29.02.2028 + 12 → 28.02.2029, 31.03 − 0 bez zmian.

#### 3. Reguły joba

**File**: `backend-subtracker/src/subscriptions/subscription-lifecycle.ts` + `.spec.ts`

**Intent**: Czysta funkcja przesunięcia daty rozliczenia: dla cyklu i „dziś” zwraca `addMonthsClamped(data, k × krok)` dla najmniejszego `k ≥ 1`, przy którym wynik ≥ dziś (krok: miesiąc = 1, rok = 12). Liczone zawsze od zapisanej daty, nie krok po kroku, więc w jednym przesunięciu dzień nie dryfuje (31.01 + 10 mies. = 30.11, nie 28.11); dla daty ≥ dziś zwraca ją bez zmian.

**Contract**: `rolledBillingDate(nextBillingDate: string, cycle: BillingCycle, today: string): string`. Testy na przykładach z „Desired End State”, w tym data równa dziś (bez zmian) i wiele zaległych cykli.

#### 4. Serwis joba

**File**: `backend-subtracker/src/subscriptions/services/subscription-lifecycle.service.ts` (nowy), `subscriptions.module.ts`

**Intent**: `advance(today)` wykonuje po kolei: `UPDATE` trial → active (`trial_end_date < :today`), `UPDATE` cancelled_pending → cancelled (`next_billing_date < :today`), potem odczyt `active` z `next_billing_date < :today` i dla każdego wiersza `UPDATE … WHERE id AND status = 'active' AND next_billing_date = <stara>` z datą z `rolledBillingDate`. Zwraca liczby przejść. Działa na wszystkich kontach (bez `userId`).

**Contract**: `advance(today: string): Promise<{ trialsActivated: number; cancellationsCompleted: number; billingDatesRolled: number }>`; parametr `today` porównywany jako `date`.

#### 5. Scheduler

**File**: `backend-subtracker/src/subscriptions/subscription-lifecycle.scheduler.ts` (nowy)

**Intent**: Wywołuje `advance(calendarDayIn(APP_TIME_ZONE, new Date()))` w `onApplicationBootstrap` (awaitowane) i w `@Cron('5 0 * * *', { timeZone: APP_TIME_ZONE })`. Flaga „w toku” pomija przebieg nakładający się na poprzedni. Loguje (`Logger`) liczby, gdy coś się zmieniło; wyjątek łapie i loguje, nie rzuca dalej.

**Contract**: provider modułu `subscriptions`; logika wyłącznie w serwisie.

#### 6. Indeksy

**File**: `backend-subtracker/src/subscriptions/entities/subscription.entity.ts`

**Intent**: Indeksy pod zapytania joba (lekcja „Indeksy tam, gdzie zapytanie albo klucz ich potrzebuje”): `(status, next_billing_date)` dla przejść 2 i 3 oraz `(status, trial_end_date)` dla przejścia 1. Migrację generuje faza 3 razem z indeksami auth.

**Contract**: dwa `@Index([...])` na klasie encji z nazwami `IDX_subscription_status_next_billing_date`, `IDX_subscription_status_trial_end_date`.

#### 7. Testy e2e joba

**File**: `backend-subtracker/test/subscriptions/subscription-lifecycle.e2e-spec.ts` (nowy)

**Intent**: Na prawdziwej bazie, z „dziś” = `calendarDayIn(APP_TIME_ZONE, new Date())` i datami względem niego: trial z końcem wczoraj → active z `trialEndDate: null` i datą rozliczenia ≥ dziś; trial z końcem dziś → bez zmian; `cancelled_pending` z rozliczeniem wczoraj → cancelled i znika z `GET /subscriptions/totals`; `cancelled_pending` z rozliczeniem dziś → bez zmian; `active` z rozliczeniem rok temu → data ≥ dziś; drugi `advance` tego samego dnia zwraca same zera dla danych testu. Serwis wywoływany przez `e2e.app.get(SubscriptionLifecycleService)`.

**Contract**: prefiks `e2e-subscriptions-lifecycle-`; asercje tylko na wierszach własnych kont (job widzi całą bazę).

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe (w tym `calendar-day.spec.ts` i reguły joba) przechodzą: `cd backend-subtracker && npm test`
- Lint i build przechodzą: `cd backend-subtracker && npm run lint && npm run build`
- Testy e2e przechodzą, w tym `subscription-lifecycle.e2e-spec.ts`: `cd backend-subtracker && npm run test:e2e`

#### Manual Verification:

- W `subtracker-db-dev` ustawione ręcznie przeszłe daty (trial, cancelled_pending, active) zmieniają się po restarcie `start:dev`, a w logu jest linia z liczbami przejść
- Lista na froncie po restarcie API pokazuje nowe statusy i daty, sumy nie zawierają zamkniętej subskrypcji

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 3: Sprzątanie tokenów i sesji

### Overview

Drugi job w module `auth` na tym samym harmonogramie, indeksy pod jego zapytania, jedna migracja z indeksami obu faz.

### Changes Required:

#### 1. Serwis sprzątania

**File**: `backend-subtracker/src/auth/services/auth-cleanup.service.ts` (nowy), `auth/auth.constants.ts`, `auth.module.ts`

**Intent**: `purge(now)` usuwa `magic_link_token` z `expires_at < now − 7 dni` oraz `session` z `expires_at < now − 7 dni`, a osobnym zapytaniem `session` z `revoked_at < now − 7 dni`. Zwraca liczby usuniętych wierszy.

**Contract**: `purge(now: Date): Promise<{ tokens: number; sessions: number }>`; stała `CLEANUP_RETENTION = 7 * 24 * 60 * 60 * 1000` w `auth.constants.ts`.

#### 2. Scheduler auth

**File**: `backend-subtracker/src/auth/auth-cleanup.scheduler.ts` (nowy)

**Intent**: Ten sam wzorzec co scheduler cyklu życia: przebieg przy starcie (awaitowany, `try/catch`) i `@Cron('5 0 * * *', { timeZone: APP_TIME_ZONE })`, log liczb.

**Contract**: provider modułu `auth`.

#### 3. Indeksy i migracja

**File**: `auth/entities/magic-link-token.entity.ts`, `auth/entities/session.entity.ts`, `src/database/migrations/<ts>-LifecycleJobIndexes.ts` (generowana)

**Intent**: `@Index()` na `magic_link_token.expires_at`, `session.expires_at`, `session.revoked_at`. Potem `npm run migration:generate -- LifecycleJobIndexes` (wobec `subtracker-db`): migracja zawiera tylko pięć `CREATE INDEX` (dwa z fazy 2, trzy z tej) i odpowiednie `DROP INDEX` w `down()`; przegląd pliku, `npm run migration:run`, commit z kodem (lekcja „Schemat bazy zmieniają tylko migracje”).

**Contract**: brak zmian kolumn; `migration:generate` uruchomiony ponownie po `migration:run` kończy się „No changes in database schema were found”.

#### 4. Test e2e

**File**: `backend-subtracker/test/auth/auth-cleanup.e2e-spec.ts` (nowy)

**Intent**: Konto z prefiksu pliku dostaje (przez `repository(...)`) token i sesję wygasłe 8 dni temu, sesję unieważnioną 8 dni temu, sesję wygasłą wczoraj i aktywną sesję; `purge(new Date())` usuwa dokładnie trzy pierwsze, aktywna sesja dalej działa (`GET /auth/me` 200).

**Contract**: prefiks `e2e-auth-cleanup-`; asercje tylko na wierszach konta testu.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na `subtracker-db`: `cd backend-subtracker && npm run migration:run`
- Brak różnicy encji względem bazy referencyjnej: `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- Testy jednostkowe, lint i build przechodzą: `cd backend-subtracker && npm test && npm run lint && npm run build`
- Testy e2e przechodzą, w tym `auth-cleanup.e2e-spec.ts`: `cd backend-subtracker && npm run test:e2e`

#### Manual Verification:

- Przegląd wygenerowanej migracji: tylko pięć indeksów, nazwy zgodne z planem, brak innych zmian schematu

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 4: Frontend — akcje Anuluj i Przywróć

### Overview

Akcje w wierszu listy (desktop i telefon), dialog anulowania, nowy tekst w dialogu usuwania, odświeżanie listy i sum, testy komponentów i ścieżka Playwright.

### Changes Required:

#### 1. Klient API

**File**: `frontend-subtracker/src/app/subscriptions/subscriptions.service.ts`

**Intent**: Metody `cancel(id)` i `resume(id)` wołające nowe trasy.

**Contract**: `cancel(id: string): Observable<Subscription>`, `resume(id: string): Observable<Subscription>` (POST bez ciała).

#### 2. Dialog anulowania

**File**: `frontend-subtracker/src/app/subscriptions/cancel-subscription-dialog/` (nowy, wzorzec `delete-subscription-dialog`)

**Intent**: Alertdialog „Anulować subskrypcję?”: dla `active` „Subskrypcja „X” będzie oznaczona jako W trakcie anulowania i zniknie z sum po {data rozliczenia}.”; dla `trial` „Okres próbny kończy się {koniec triala}. Po tym dniu subskrypcja zostanie anulowana bez płatności.”. Przyciski „Wróć” (pierwszy, z fokusem) i „Anuluj subskrypcję”; dialog sam wysyła żądanie, w trakcie oba przyciski wyłączone, błąd sieci pokazuje komunikat w dialogu.

**Contract**: `openCancelSubscriptionDialog(dialog, subscription)` zwraca wynik `'cancelled' | 'missing' | 'conflict' | undefined` (404 → `missing`, 409 → `conflict`).

#### 3. Tabela

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.{ts,html,scss}`

**Intent**: Nowe wyjścia `cancel` i `resume`. Desktop: ikona z tooltipem „Anuluj subskrypcję” dla `active`/`trial`, „Przywróć” dla `cancelled_pending` (inline SVG, jak ołówek i kosz); telefon: przycisk z ikoną w rozwiniętym wierszu obok Edytuj/Usuń. `cancelled` nie ma żadnej z tych akcji. Szerokość kolumny akcji nie może przywrócić poziomego scrolla przy 840 px i 1200 px z otwartym panelem.

**Contract**: `readonly cancel = output<Subscription>()`, `readonly resume = output<Subscription>()`.

#### 4. Strona

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts`, `subscription-labels.ts`

**Intent**: Obsługa jak po usunięciu: po `cancelled` lub udanym `resume` zamknąć edycję tej subskrypcji (jeśli otwarta), komunikat w regionie na żywo („Anulowano subskrypcję „X”.” / „Przywrócono subskrypcję „X”.”), `load(true)` i `totals.refresh()`. `missing` → istniejący komunikat „Tej subskrypcji już nie ma na liście.” + odświeżenie; `conflict` → „Stan subskrypcji zmienił się w międzyczasie.” + odświeżenie. „Przywróć” w trakcie żądania wyłączony; błąd sieci → komunikat o niepowodzeniu bez odświeżenia. Komentarz przy `relativeDays()` zaktualizować (job działa od S-05, przeszła data oznacza najwyżej dobę opóźnienia).

**Contract**: funkcje komunikatów obok `deletedSubscriptionMessage`.

#### 5. Dialog usuwania

**File**: `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/delete-subscription-dialog.html`

**Intent**: Drugi akapit odsyła do akcji „Anuluj subskrypcję” zamiast do zmiany statusu.

**Contract**: tylko tekst.

#### 6. Testy

**File**: `cancel-subscription-dialog.spec.ts` (nowy), `subscription-table.spec.ts`, `subscriptions.spec.ts`, `subscriptions.service` (jeśli ma spec), `frontend-subtracker/e2e/browser/subscription-cancel.e2e-spec.ts` (nowy)

**Intent**: Komponent: treść dialogu dla `active` i `trial`, fokus na „Wróć”, wyniki 200/404/409/błąd; tabela pokazuje właściwą akcję dla każdego z 4 statusów; strona zamyka edycję anulowanej subskrypcji i odświeża sumy. Playwright (§6.5): seed `active` → „Anuluj subskrypcję” → potwierdzenie → etykieta „W trakcie anulowania” → „Przywróć” → „Aktywna”.

**Contract**: według `test-plan.md` §6.2 i §6.5.

### Success Criteria:

#### Automated Verification:

- Testy frontu w obu strefach przechodzą: `cd frontend-subtracker && npm run test:ci`
- Build przechodzi: `cd frontend-subtracker && npm run build`
- Playwright przechodzi, w tym `subscription-cancel.e2e-spec.ts`: `cd frontend-subtracker && npm run build:e2e && npm run e2e`

#### Manual Verification:

- Desktop: anulowanie `active` i `trial` przez dialog, przywrócenie, sumy bez zmian po anulowaniu, po przywróceniu też
- Telefon (< 840 px): akcje w rozwiniętym wierszu, dialog czytelny, brak poziomego scrolla
- Anulowanie subskrypcji otwartej w panelu edycji zamyka panel; fokus wraca w sensowne miejsce
- Tryb klawiatury: Escape w dialogu = „Wróć”, fokus wraca na przycisk akcji

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 5: Dokumentacja i cookbook

### Overview

Zapis reguł i wzorców, żeby S-06 (przypomnienia) i kolejne joby zaczynały od gotowego przepisu.

### Changes Required:

#### 1. Wzorce backendu

**File**: `context/foundation/backend-patterns.md`

**Intent**: Nowa sekcja „Cykl życia i zadania cykliczne”: akcje użytkownika vs edycja (pełna korekta), reguły joba (`data < dziś`, `Europe/Warsaw`, kolejność 1 → 2 → 3, przesuwanie z przycięciem), wzorzec schedulera (logika w serwisie z parametrem „dziś”, start + cron, awaitowany start z `try/catch`, flaga „w toku”), idempotencja przez warunek w `UPDATE` zamiast znacznika (znacznik potrzebny dopiero dla efektów zewnętrznych jak e-mail w S-06).

**Contract**: sekcja Markdown; odwołanie do `lessons.md`.

#### 2. Cookbook testów

**File**: `context/foundation/test-plan.md`

**Intent**: W §6.3/§6.4 przepis „test zależny od czasu”: czysta funkcja z parametrem „dziś” w unit, e2e joba z prawdziwym „dziś” i datami względem niego, nigdy „dziś” z przyszłości, asercje tylko na wierszach własnego konta. W §6.6 notatka po S-05. Regułę `--refresh` po S-05 (§8) zostawić do uruchomienia `/10x-test-plan --refresh` po archiwizacji.

**Contract**: tylko §6; §1–§5 zamrożone.

#### 3. CLAUDE.md i deploy

**File**: `CLAUDE.md`, `deploy/mydevil/README.md`

**Intent**: CLAUDE.md, Architecture: scheduler istnieje (job cyklu życia i sprzątania, start + 00:05 Warsaw), usunąć „Still planned: subscription state machine”. README deployu: po każdym starcie API job nadrabia przejścia; po rollbacku z dumpu powtórzy je sam.

**Contract**: tylko tekst.

### Success Criteria:

#### Automated Verification:

- Formatowanie dokumentów nie psuje lintu ani testów: `cd backend-subtracker && npm run lint`

#### Manual Verification:

- Przegląd sekcji `backend-patterns.md` i §6 `test-plan.md`: przepis pozwala napisać test joba S-06 bez czytania kodu S-05

---

## Testing Strategy

### Unit Tests:

- `calendarDayIn`: granica doby w Warszawie, obie zmiany czasu, niezależność od `TZ` procesu.
- `addMonthsClamped` i `rolledBillingDate`: koniec miesiąca, rok przestępny, data równa dziś, wiele zaległych cykli, cykl roczny.
- Listy statusów akcji (dokładne wartości).
- Front: dialog anulowania (teksty, fokus, wyniki), akcje tabeli dla 4 statusów, obsługa wyników na stronie.

### Integration Tests:

- API akcji: przejścia, 404/409/400, dwa konta, rejestr tras, brak sesji.
- Job: przejścia na granicy dnia (wczoraj vs dziś), sumy po zamknięciu, idempotencja.
- Sprzątanie: granica 7 dni, aktywna sesja nietknięta.
- Playwright: anuluj → przywróć w przeglądarce.

### Manual Testing Steps:

1. Anulować trial i active w UI, sprawdzić daty i sumy; przywrócić.
2. W bazie dev ustawić przeszłe daty, zrestartować `start:dev`, sprawdzić log i listę.
3. Po deployu na produkcję: log startu API z przebiegiem joba (także „0 zmian” nie musi być logowane — sprawdzić brak błędów w `err.log`), następnego dnia po 00:05 brak błędów.

## Performance Considerations

Job działa na całej tabeli, ale filtruje po indeksach `(status, data)`; przesuwanie dat to pętla po wierszach `active` z przeszłą datą — po pierwszym przebiegu każdego dnia to tylko subskrypcje z rozliczeniem wczoraj. Przy skali MVP pomijalne.

## Migration Notes

- Jedna migracja `LifecycleJobIndexes` (tylko indeksy) w oknie przestoju deployu, po `pg_dump`.
- Pierwszy start po deployu wykona zaległe przejścia na danych produkcyjnych (np. active z dawnymi datami dostanie aktualne). Rollback z dumpu je cofnie; kolejny start poprzedniej wersji ich nie powtórzy (stara wersja nie ma joba) — akceptowalne.
- Frontend i backend wdrażają się osobno: stary frontend po nowym API działa (kontrakt `PUT` bez zmian, nowe trasy nieużywane), nowy frontend wymaga nowego API — backend wchodzi pierwszy z tego samego merge'a.

## References

- Research: `context/changes/subscription-lifecycle/research.md`
- PRD: `context/foundation/prd.md` FR-013, FR-005, FR-006
- Roadmapa: `context/foundation/roadmap.md` S-05
- Lekcje: `context/foundation/lessons.md` (zadania cykliczne, migracje, indeksy, `shared/`)
- Wzorzec dialogu: `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/`
- Wzorzec zapisu warunkowego: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:138-160`
- Cookbook testów: `context/foundation/test-plan.md` §6.3–§6.5
- Ryzyko strefy czasowej: `context/foundation/infrastructure.md` (Unknown Unknowns, Risk Register)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API — anuluj i przywróć

#### Automated

- [x] 1.1 Testy jednostkowe backendu przechodzą
- [x] 1.2 Lint przechodzi
- [x] 1.3 Build przechodzi
- [x] 1.4 Testy e2e API przechodzą, w tym nowy plik akcji i rejestr tras

#### Manual

- [x] 1.5 Anulowanie triala przez API zwraca datę rozliczenia równą dawnemu końcowi triala, ponowne anulowanie 409

### Phase 2: Scheduler i job cyklu życia

#### Automated

- [ ] 2.1 Testy jednostkowe (w tym calendar-day i reguły joba) przechodzą
- [ ] 2.2 Lint i build przechodzą
- [ ] 2.3 Testy e2e przechodzą, w tym subscription-lifecycle.e2e-spec.ts

#### Manual

- [ ] 2.4 Przeszłe daty w bazie dev zmieniają się po restarcie start:dev, log z liczbami przejść
- [ ] 2.5 Lista po restarcie API pokazuje nowe statusy i daty, sumy bez zamkniętej subskrypcji

### Phase 3: Sprzątanie tokenów i sesji

#### Automated

- [ ] 3.1 Migracja stosuje się na subtracker-db
- [ ] 3.2 Brak różnicy encji względem bazy referencyjnej
- [ ] 3.3 Testy jednostkowe, lint i build przechodzą
- [ ] 3.4 Testy e2e przechodzą, w tym auth-cleanup.e2e-spec.ts

#### Manual

- [ ] 3.5 Przegląd wygenerowanej migracji: tylko pięć indeksów

### Phase 4: Frontend — akcje Anuluj i Przywróć

#### Automated

- [ ] 4.1 Testy frontu w obu strefach przechodzą
- [ ] 4.2 Build przechodzi
- [ ] 4.3 Playwright przechodzi, w tym subscription-cancel.e2e-spec.ts

#### Manual

- [ ] 4.4 Desktop: anulowanie active i trial, przywrócenie, sumy
- [ ] 4.5 Telefon: akcje w rozwiniętym wierszu, dialog, brak poziomego scrolla
- [ ] 4.6 Anulowanie subskrypcji otwartej w edycji zamyka panel
- [ ] 4.7 Klawiatura: Escape w dialogu i powrót fokusu

### Phase 5: Dokumentacja i cookbook

#### Automated

- [ ] 5.1 Lint backendu przechodzi po zmianach dokumentacji

#### Manual

- [ ] 5.2 Przepis w backend-patterns.md i test-plan §6 wystarcza do testu joba S-06
