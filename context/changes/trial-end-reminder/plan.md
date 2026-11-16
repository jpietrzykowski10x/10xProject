# Przypomnienie przed końcem triala (S-06) — plan implementacji

## Overview

Użytkownik z subskrypcją w statusie `trial` dostaje e-mail, gdy do końca okresu próbnego zostaje 7 dni lub mniej: jeden mail zbiorczy na przebieg joba, z listą wszystkich jego triali w oknie. Przypomnienie o danej dacie końca triala wychodzi dokładnie raz. Przesunięcie daty końca w edycji uzbraja je ponownie. Błąd SMTP nie zużywa przypomnienia, więc kolejny przebieg spróbuje znowu. Job biegnie codziennie o 02:00 `Europe/Warsaw` oraz w tle przy każdym starcie API. FR-014, roadmapa S-06.

## Current State Analysis

- Job cyklu życia z S-05 ustawia wzorzec: logika w serwisie z „dziś” w parametrze, scheduler z `onApplicationBootstrap` (awaitowany) i `@Cron(..., { timeZone: APP_TIME_ZONE })`, flaga `running` (`src/subscriptions/subscription-lifecycle.scheduler.ts:11-58`, `services/subscription-lifecycle.service.ts`). `backend-patterns.md` („Idempotencja przez warunek w `UPDATE`, nie przez znacznik”) przesądza, że mail jako efekt poza bazą potrzebuje trwałego znacznika w bazie, zapytania „termin minął i nie wysłano” i warunkowego `UPDATE`.
- `subscription` ma `status`, `trial_end_date date NULL`, `next_billing_date`, indeks `(status, trial_end_date)` (`entities/subscription.entity.ts:24-29`). Brak jakiegokolwiek znacznika przypomnienia.
- Anulowanie triala zeruje `trial_end_date` (`services/subscriptions.service.ts` `cancel`), job cyklu życia zeruje je przy `trial → active`, a `PUT` zeruje je dla statusu innego niż `trial` (`subscriptionFields`). `PUT` może przy tym ustawić dowolną nową datę końca.
- `MailService.sendToUser` nigdy nie rzuca i zwraca `void`. Niepowodzenie ląduje w wierszu audytu `mail` (`FAILED`) i w alercie operatora, wysyłanym maks. raz na 15 min i pomijanym przy trwałym odrzuceniu adresata (`mail/services/mail.service.ts:64-73`, `95-114`). Wywołujący nie wie, czy mail wyszedł.
- `MailType` ma tylko `MAGIC_LINK` i `OPERATOR_ALERT` (`mail/mail.types.ts:1-4`). Szablon maila to czysta funkcja zwracająca `MailContent` z escapowaniem (`auth/mail-templates.ts`).
- `user.is_active` (blokada konta, S-09) istnieje; logowanie i sesja już go sprawdzają.
- Deploy: health-check to 5 prób co 3 s (`deploy/mydevil/deploy.sh:56-66`), a nieudany health-check przywraca bazę z dumpu sprzed deployu.
- Pomocnik e2e `close()` czeka, aż liczba wierszy audytu `mail` dla adresów pliku zrówna się z **całym** `sent` (`test/support/e2e-app.ts:233-241`). Fałszywy transport zawsze się udaje (`:193-199`).
- `main.ts` nie włącza `enableShutdownHooks`; hooki zamknięcia działają tylko przy `app.close()` (e2e).

## Desired End State

- Kolumna `subscription.trial_reminder_sent_for date NULL`: data końca triala, dla której przypomnienie wyszło (albo jest właśnie wysyłane).
- **Reguła wysyłki** („dziś” = dzień w `Europe/Warsaw`): wiersz jest zaległy, gdy `status = 'trial'`, `dziś ≤ trial_end_date ≤ dziś + 7`, `trial_reminder_sent_for IS DISTINCT FROM trial_end_date`, a konto ma `is_active = true`.
- Przykłady (dziś = 2026-11-13, nic jeszcze nie wysłano):
  - koniec 2026-11-20 → mail („za 7 dni”);
  - koniec 2026-11-21 → brak (8 dni);
  - koniec 2026-11-16 → mail („za 3 dni”, trial dodany już w oknie albo pominięty dzień);
  - koniec 2026-11-14 → mail („jutro”); koniec 2026-11-13 → mail („dziś”);
  - koniec 2026-11-12 → brak (trial już się skończył; job cyklu życia zmieni go w `active`);
  - API nie działało 2026-11-13 i wstaje 2026-11-14 → trial z końcem 2026-11-20 dostaje mail 2026-11-14 („za 6 dni”).
- Po wysyłce (sent_for = 2026-11-20) użytkownik przesuwa w `PUT` koniec na 2026-12-20 → od 2026-12-13 wychodzi drugi mail. Przesunięcie w obrębie okna (2026-11-20 → 2026-11-19) też wysyła ponownie. Zmiana statusu `trial → active → trial` z tą samą datą nie wysyła drugi raz.
- Jeden przebieg wysyła każdemu użytkownikowi **jeden** mail z wszystkimi jego zaległymi trialami. Każda pozycja ma nazwę, datę końca (`20.11.2026`), liczbę dni („dziś” / „jutro” / „za N dni”) i kwotę po trialu (`43,00 zł / mies.` albo `/ rok`). Mail zawiera link do `${FRONTEND_URL}/subscriptions` i wskazówkę: zrezygnuj u dostawcy przed końcem triala i oznacz subskrypcję jako anulowaną w SubTrackerze. Treść jest po polsku, a dane użytkownika w HTML są escapowane.
- **Kolejność dla jednego użytkownika:** rezerwacja wierszy (warunkowy `UPDATE … SET trial_reminder_sent_for = trial_end_date … RETURNING`), wysyłka, a gdy mail nie wyszedł — zwolnienie (`SET trial_reminder_sent_for = NULL WHERE id IN (…) AND trial_reminder_sent_for = trial_end_date`). Dwa nakładające się przebiegi nigdy nie wyślą dwóch maili o tym samym wierszu. Pad procesu między rezerwacją a wysyłką gubi przypomnienia tylko tego jednego użytkownika (świadomie zaakceptowane).
- Job: codziennie o 02:00 `Europe/Warsaw` oraz przy starcie aplikacji **w tle, bez czekania**, więc start i health-check deployu nie zależą od SMTP. Log z liczbami pojawia się tylko wtedy, gdy przebieg coś zrobił. Błąd całego przebiegu idzie do logu i do maila operatora; błąd jednego użytkownika jest logowany i nie zatrzymuje pozostałych.
- Audyt: każdy mail ma wiersz `mail` z typem `TRIAL_REMINDER` (`SENT`/`FAILED`); nieudana wysyłka uruchamia istniejący alert operatora.

### Key Discoveries:

- Wzorzec schedulera i serwisu joba: `src/subscriptions/subscription-lifecycle.scheduler.ts:11-58`, `services/subscription-lifecycle.service.ts:21-55`.
- Warunkowy `UPDATE` z odczytaną wartością w `WHERE` (ochrona przed nadpisaniem): `subscription-lifecycle.service.ts:73-90`.
- Szablon maila jako czysta funkcja z `escapeHtml`: `src/auth/mail-templates.ts:13-38`.
- Kontrakt „nigdy nie rzuca” i alert operatora: `src/mail/services/mail.service.ts:48-114`.
- `FRONTEND_URL` z env: `src/auth/services/auth.service.ts:44`.
- Testy jobów: `test-plan.md` §6.3 (czyste funkcje z dowolnym „dziś”) i §6.4 („Test zależny od czasu — job”, w tym zasada „maile sprawdzasz w `sent` tylko dla adresów pliku”).
- Indeks `IDX_subscription_status_trial_end_date` obsługuje filtr joba, więc nowy indeks nie jest potrzebny (lekcja o indeksach: nowa kolumna nie jest FK ani pierwszą kolumną filtra).

## What We're NOT Doing

- Brak wykrywania, że proces API w ogóle nie działa (zewnętrzny monitoring `/health`) i brak raportu triali zakończonych bez przypomnienia. Pad między rezerwacją a wysyłką zostawia tylko ślad: znacznik bez wiersza audytu.
- Brak osobnego traktowania trwałego odrzucenia adresu (SMTP 5xx na `RCPT TO`): zwolnienie i ponowienie w kolejnych przebiegach, najwyżej do końca triala.
- Brak przypomnień dla zablokowanych kont (`is_active = false`).
- Brak ustawień użytkownika (wyłączenie przypomnień, inny termin niż 7 dni), brak strefy czasowej per użytkownik i brak linku do wypisania się.
- Brak zmian we frontendzie (np. znacznika „przypomnienie wysłane” na liście).
- Brak konfigurowalnej godziny: 02:00 to stała w kodzie.
- Brak blokady między procesami (jedna instancja API, jak w S-05) i brak `enableShutdownHooks` w `main.ts`.
- Brak okresowego maila z alertami (FR-015).

## Implementation Approach

Najpierw czyste klocki z testami jednostkowymi: kolumna i migracja, typ maila, zwracany wynik `sendToUser`, funkcje dni w `shared/date/`, szablon maila. Potem serwis joba (zapytania i kolejność rezerwacja → wysyłka → zwolnienie) i scheduler według wzorca S-05, z jednym odstępstwem: przebieg przy starcie nie jest awaitowany. Na koniec dokumentacja wzorca dla kolejnych jobów z efektem zewnętrznym. Logika dni (okno, „za N dni”) to czyste funkcje z „dziś” w parametrze. SQL dostaje oba końce okna jako parametry (`CAST(:today AS date)`, `CAST(:windowEnd AS date)`), nigdy `CURRENT_DATE`.

## Critical Implementation Details

- **Start w tle, a nie awaitowany.** Wysyłka SMTP przy starcie (wielu użytkowników, zawieszony serwer SMTP) może przekroczyć ok. 15 s health-checku `deploy.sh`. Nieudany health-check przywraca bazę z dumpu: znaczniki znikają, a poprzednia wersja (jeśli ma job) wysłałaby maile drugi raz. `onApplicationBootstrap` uruchamia więc `run()` bez `await` (`run()` sam łapie wszystkie błędy). Scheduler trzyma obietnicę bieżącego przebiegu i czeka na nią w `beforeApplicationShutdown`, żeby `app.close()` w e2e nie zamknął połączenia z bazą w trakcie przebiegu.
- **Pomocnik e2e musi liczyć tylko maile adresów pliku.** Przebieg przy starcie wysyła przez fałszywy transport przypomnienia do innych kont z bazy dev, a po błędzie wysyłki MailService wysyła też alert operatora. `close()` porównujące audyt pliku z całym `sent` byłoby wtedy czerwone w każdym pliku e2e. Ta zmiana wchodzi w tej samej fazie co scheduler.
- **Rezerwacja per użytkownik, nie jednym `UPDATE` dla wszystkich.** Najpierw odczyt par (`user_id`, `email`) z zaległymi wierszami, potem dla każdej pary osobna rezerwacja z warunkiem na `user_id`. Pad procesu gubi wtedy najwyżej paczkę jednego użytkownika. Postgres 16 nie zwraca starej wartości w `RETURNING`, dlatego zwolnienie ustawia `NULL`. Semantycznie to to samo co poprzednia wartość, bo `NULL` ≠ data końca. Warunek `trial_reminder_sent_for = trial_end_date` w zwolnieniu nie nadpisuje edycji zrobionej w międzyczasie.
- **02:00 a zmiana czasu:** wiosną 02:00 w Warszawie nie istnieje, jesienią występuje dwa razy. Podwójny przebieg nic nie zmienia (znacznik), a pominięty dzień nadrabia okno 7 dni. Kod nie potrzebuje obsługi tego przypadku.

## Phase 1: Elementy bazowe

### Overview

Wszystko, czego job potrzebuje, jako małe testowalne klocki: kolumna z migracją, typ maila, wynik wysyłki, funkcje dni i szablon maila zbiorczego.

### Changes Required:

#### 1. Kolumna znacznika

**File**: `backend-subtracker/src/subscriptions/entities/subscription.entity.ts`

**Intent**: Trwały ślad, dla której daty końca triala przypomnienie już wyszło; porównanie z `trial_end_date` daje „raz na datę końca” bez logiki w `PUT` i akcjach.

**Contract**: `@Column({ name: 'trial_reminder_sent_for', type: 'date', nullable: true }) trialReminderSentFor: string | null` z komentarzem o znaczeniu. Bez indeksu. `SubscriptionResponse` się nie zmienia (pole nie wychodzi do API).

#### 2. Migracja

**File**: `backend-subtracker/src/database/migrations/<timestamp>-TrialReminderSentFor.ts` (generowana)

**Intent**: Schemat na `subtracker-db` i produkcji (lekcja o migracjach).

**Contract**: `npm run migration:generate -- TrialReminderSentFor` → jeden `ALTER TABLE "subscription" ADD "trial_reminder_sent_for" date` (nullable, więc bez backfillu i bez skryptu dla bazy dev), `down()` z `DROP COLUMN`. Przegląd pliku, `npm run migration:run`.

#### 3. Typ maila i wynik wysyłki

**Files**: `backend-subtracker/src/mail/mail.types.ts`, `src/mail/services/mail.service.ts`, `src/mail/services/mail.service.spec.ts`

**Intent**: Audyt rozróżnia przypomnienia od linków logowania, a job musi wiedzieć, czy mail wyszedł, żeby zwolnić rezerwację.

**Contract**: `MailType.TRIAL_REMINDER = 'TRIAL_REMINDER'` (mieści się w `varchar(30)`). `sendToUser(...)` zwraca `Promise<boolean>`: `true`, gdy transport przyjął mail (niezależnie od zapisu audytu), `false` po błędzie transportu. Nadal nigdy nie odrzuca. Komentarz klasy uzupełniony o znaczenie wyniku. Wywołanie w `auth.service.ts` (`void`) bez zmian. Testy: `true` po sukcesie, `false` po błędzie SMTP, `false` przy odrzuconym adresacie, `true` także wtedy, gdy zapis audytu się nie powiódł.

#### 4. Funkcje dni

**Files**: `backend-subtracker/src/shared/date/calendar-day.ts`, `calendar-day.spec.ts`

**Intent**: Koniec okna (`dziś + 7`) i liczba dni do końca triala jako czyste funkcje na `YYYY-MM-DD` (lekcja: kod ogólny w `shared/`).

**Contract**: `addDays(day: string, days: number): string` (całkowita liczba dni, także ujemna; błąd dla niepoprawnego dnia, jak `addMonthsClamped`) i `daysBetween(from: string, to: string): number` (różnica dni kalendarzowych, liczona na UTC, więc niezależna od strefy procesu). Testy `it.each`: przełom miesiąca, 28/29 lutego w roku przestępnym i zwykłym, przełom roku, weekend zmiany czasu w Warszawie (2026-03-29, 2026-10-25), wartości ujemne, `daysBetween(d, d) = 0`.

#### 5. Reguła okna i szablon maila

**Files**: `backend-subtracker/src/subscriptions/trial-reminder.ts`, `trial-reminder.spec.ts`

**Intent**: Logika domeny przypomnień w module `subscriptions`: długość okna, opis dni, treść maila zbiorczego.

**Contract**:
- `TRIAL_REMINDER_DAYS_BEFORE = 7`; `trialReminderWindow(today) → { from: today, to: addDays(today, 7) }`.
- `TrialReminderItem { name: string; trialEndDate: string; amount: string; billingCycle: BillingCycle }`.
- `trialReminderMail({ items, today, subscriptionsUrl }): MailContent`: pozycje posortowane po dacie końca, potem po nazwie (`localeCompare(..., 'pl')`); opis dni `dziś` / `jutro` / `za N dni` z `daysBetween`; data `DD.MM.YYYY`; kwota `43,00 zł / mies.` albo `/ rok` (z przecinkiem, ze stringa `numeric`, bez floatów). Temat: dla jednej pozycji `Okres próbny „<nazwa>” kończy się <dziś|jutro|za N dni>`, dla wielu `Kończą się okresy próbne (N)`. Tekst i HTML, wszystkie wartości użytkownika przez `escapeHtml`, link do `subscriptionsUrl`, wskazówka o rezygnacji u dostawcy i oznaczeniu anulowania w SubTrackerze.
- Testy: jedna i wiele pozycji (temat, kolejność), granice opisu dni (0, 1, 2, 7), kwota miesięczna i roczna (`"1234.50"` → `1234,50 zł / rok`), nazwa z `<script>` i `&` escapowana w HTML i nieescapowana w tekście, link obecny w obu wersjach.

### Success Criteria:

#### Automated Verification:

- Migracja wygenerowana, przejrzana i zastosowana: `cd backend-subtracker && npm run migration:run`; `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- Testy jednostkowe przechodzą: `cd backend-subtracker && npm test`
- Lint i typy: `cd backend-subtracker && npm run lint && npm run build`

#### Manual Verification:

- Treść przykładowego maila (wydruk z testu albo snapshot w konsoli) czyta się naturalnie po polsku dla jednej i trzech pozycji

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: Job przypomnień

### Overview

Serwis joba (odczyt zaległych użytkowników, rezerwacja, wysyłka, zwolnienie), scheduler 02:00 i start w tle, poprawka pomocnika e2e oraz e2e joba na prawdziwym „dziś”.

### Changes Required:

#### 1. Serwis joba

**File**: `backend-subtracker/src/subscriptions/services/trial-reminder.service.ts`

**Intent**: Cała logika przebiegu z „dziś” w parametrze, wywoływalna wprost z testu.

**Contract**: `TrialReminderService.sendDue(today: string): Promise<TrialReminderRunResult>`, gdzie `TrialReminderRunResult { usersNotified: number; remindersSent: number; usersFailed: number }`. Kroki:
1. Odczyt różnych par (`user_id`, `email`) z zaległymi wierszami: join z `user`, `is_active = true`, `status = 'trial'`, `trial_end_date BETWEEN CAST(:from AS date) AND CAST(:to AS date)`, `trial_reminder_sent_for IS DISTINCT FROM trial_end_date`.
2. Dla każdej pary, w osobnym `try/catch`: warunkowy `UPDATE … SET trial_reminder_sent_for = trial_end_date WHERE user_id = :userId AND <te same warunki> RETURNING id, name, amount, billing_cycle, trial_end_date`. Przy 0 wierszach pomiń (inny przebieg albo edycja zdążyły pierwsze).
3. `mail.sendToUser(MailType.TRIAL_REMINDER, email, trialReminderMail({ items, today, subscriptionsUrl: \`${FRONTEND_URL}/subscriptions\` }))`.
4. Gdy wynik to `false`: `UPDATE … SET trial_reminder_sent_for = NULL WHERE id IN (:...ids) AND trial_reminder_sent_for = trial_end_date`, a użytkownik liczy się do `usersFailed`. Błąd bazy w kroku 2–4 jest logowany samym `error.message` (bez adresu), liczy się do `usersFailed` i nie przerywa pętli.

Odczyt w kroku 1 i warunek w kroku 2 dzielą jedną funkcję budującą warunki (bez kopii SQL).

#### 2. Scheduler

**File**: `backend-subtracker/src/subscriptions/trial-reminder.scheduler.ts`

**Intent**: Wyzwalacze według wzorca S-05 z dwiema różnicami: start w tle i alert operatora po błędzie przebiegu.

**Contract**: `@Cron('0 2 * * *', { timeZone: APP_TIME_ZONE })` (stała `TRIAL_REMINDER_CRON` w module); `onApplicationBootstrap()` uruchamia `run()` bez `await`; `beforeApplicationShutdown()` czeka na bieżący przebieg. `run()`: flaga `running` (przebieg nakładający się na poprzedni jest pomijany z ostrzeżeniem), `today = calendarDayIn(APP_TIME_ZONE, new Date())`, `sendDue(today)`, `Logger.log` z liczbami tylko przy wyniku > 0, `Logger.warn` przy `usersFailed > 0`. Błąd całego przebiegu → `Logger.error` z samym `message` + `mail.notifyOperator(...)` z tematem `SubTracker: przebieg przypomnień o trialu nie powiódł się` i datą przebiegu, bez treści błędu i bez danych użytkowników. `run()` nigdy nie odrzuca.

#### 3. Moduł

**File**: `backend-subtracker/src/subscriptions/subscriptions.module.ts`

**Intent**: Podpięcie serwisu, schedulera i maili.

**Contract**: `imports` + `MailModule`; `providers` + `TrialReminderService`, `TrialReminderScheduler`. `ConfigService` dla `FRONTEND_URL` przez `envFromConfig` jak w `AuthService`.

#### 4. Pomocnik e2e

**File**: `backend-subtracker/test/support/e2e-app.ts`

**Intent**: Maile spoza pliku (przypomnienia do innych kont z bazy dev, alerty operatora) nie psują `close()`, a test może wymusić błąd transportu bez mockowania serwisów (cookbook §6.4: zastąpiony jest tylko transport).

**Contract**: `close()` porównuje liczbę wierszy audytu dla adresów pliku z liczbą maili w `sent` adresowanych do adresów pliku (`to` pasuje do prefiksu i domeny `ADDRESS_DOMAIN`). Nowy członek `E2eApp.failMailTo(address: string, fail: boolean): void`: fałszywy transport dopisuje taki mail do `sent`, a potem odrzuca błędem `connection refused` (bez pól SMTP, więc MailService traktuje go jak awarię serwera). Komentarz `sent` zostaje prawdziwy („every mail the app tried to send”).

#### 5. E2e joba

**File**: `backend-subtracker/test/subscriptions/trial-reminder.e2e-spec.ts` (prefiks `e2e-subscriptions-trial-reminder-`)

**Intent**: Reguła okna, jeden mail zbiorczy, „dokładnie raz”, ponowne uzbrojenie, pomijanie zablokowanych kont i zwolnienie po błędzie, na prawdziwym „dziś” i prawdziwej bazie.

**Contract** (według §6.4 „Test zależny od czasu — job”; serwis wołany wprost `e2e.app.get(TrialReminderService).sendDue(today)`; asercje tylko na wierszach i mailach adresów pliku; subskrypcje przez `POST /subscriptions`):
- konto A, triale z końcem: `today+7`, `today+3`, `today` (zaległe), `today+8` i `yesterday` (poza oknem), trial anulowany akcją `cancel` (bez daty końca), subskrypcja `active` → po przebiegu dokładnie jeden mail do A zawierający trzy zaległe nazwy i żadnej innej; `trial_reminder_sent_for` = `trial_end_date` dla trzech, `null` dla reszty;
- drugi przebieg tego samego dnia: brak nowych maili do adresów pliku, wiersze pliku `toEqual` odczytom sprzed przebiegu;
- `PUT` przesuwa koniec jednego z przypomnianych triali na `today+5` → kolejny przebieg wysyła do A jeden mail z tą jedną pozycją;
- konto B z zaległym trialem zablokowane (`is_active = false` przez `repository(User)`) → brak maila, znacznik `null`;
- konto C z zaległym trialem i `failMailTo(C, true)` → po przebiegu znacznik `null` i wiersz audytu `TRIAL_REMINDER` ze statusem `FAILED`; po `failMailTo(C, false)` kolejny przebieg wysyła mail i ustawia znacznik;
- wynik `sendDue` sprawdzany tylko przez `toBeGreaterThanOrEqual` (obejmuje całą bazę).

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `cd backend-subtracker && npm test`
- Nowy plik e2e przechodzi: `cd backend-subtracker && npx vitest run --config ./vitest.config.e2e.ts test/subscriptions/trial-reminder.e2e-spec.ts`
- Cały zestaw e2e przechodzi (pomocnik `close()` nie psuje innych plików): `cd backend-subtracker && npm run test:e2e`
- Lint i typy: `cd backend-subtracker && npm run lint && npm run build`
- Sabotaż: usunięcie warunku `IS DISTINCT FROM` z zapytania daje czerwony test drugiego przebiegu; usunięcie zwolnienia daje czerwony test konta C

#### Manual Verification:

- `npm run start:dev` z trialem w oknie na własnym koncie w `subtracker-db-dev`: log „Nest application successfully started” pojawia się bez czekania na wysyłkę, a mail (na konsoli przy pustym `SMTP_HOST` albo w skrzynce) zawiera poprawne pozycje, daty, kwoty i link
- Restart API tego samego dnia nie wysyła drugiego maila

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Dokumentacja i weryfikacja ręczna

### Overview

Wzorzec joba z efektem zewnętrznym zapisany dla kolejnych slice'ów (FR-015, S-09), cookbook testów uzupełniony i opis architektury aktualny.

### Changes Required:

#### 1. Wzorce backendu

**File**: `context/foundation/backend-patterns.md`

**Intent**: Następny job z mailem dostaje gotową regułę zamiast odkrywać ją od nowa.

**Contract**: W sekcji „Cykl życia i zadania cykliczne” nowy punkt „Przypomnienia o trialu (S-06)”: reguła okna, znacznik „dla daty”, kolejność rezerwacja → wysyłka → zwolnienie i jej świadomie przyjęte ryzyko, mail zbiorczy per użytkownik, pomijanie `is_active = false`, 02:00 i zmiana czasu, start w tle (z powodem: health-check i przywrócenie dumpu), alert operatora po błędzie przebiegu, `sendToUser` → `boolean`. Akapit „Idempotencja przez warunek w `UPDATE`” dostaje odsyłacz do tego punktu. W zdaniu wstępnym dokumentu „(najbliżej S-06, przypomnienia o trialach)” zamienione na stan faktyczny.

#### 2. Cookbook testów

**File**: `context/foundation/test-plan.md`

**Intent**: §6 odpowiada na pytanie „jak przetestować job z mailem”.

**Contract**: §6.4 — w punkcie o jobie z efektem zewnętrznym opis `failMailTo` i zawężonego `close()`, test referencyjny `test/subscriptions/trial-reminder.e2e-spec.ts`; §6.3 — referencje `trial-reminder.spec.ts` i `addDays`/`daysBetween`. §7 — wiersz „Joby cyklu życia i przypomnienia o trialu — jeszcze nie istnieją” zaktualizowany (oba istnieją i są pokryte; zostaje tylko wykrywanie niedziałającego procesu jako poza zakresem).

#### 3. CLAUDE.md

**File**: `CLAUDE.md` (sekcja Repository notes → Architecture)

**Intent**: Opis backendu zgodny z kodem.

**Contract**: Zdanie „Still planned per `tech-stack.md`: trial reminder e-mails (S-06)” zastąpione krótkim opisem joba przypomnień (02:00, start w tle, znacznik `trial_reminder_sent_for`, odsyłacz do `backend-patterns.md`).

### Success Criteria:

#### Automated Verification:

- Pełny zestaw nadal zielony: `cd backend-subtracker && npm test && npm run test:e2e && npm run lint`

#### Manual Verification:

- Prawdziwy mail z przypomnieniem dociera do Gmaila przez SMTP MyDevil (lokalnie z `SMTP_*` z `.env`, na własny adres), poprawnie wyświetla polskie znaki i link
- Po deployu na produkcję: health-check przechodzi przy pierwszej próbie, a log API pokazuje przebieg przypomnień po starcie (albo brak logu, gdy nie ma zaległych)
- Opisy w `backend-patterns.md`, `test-plan.md` i `CLAUDE.md` zgadzają się z kodem

**Implementation Note**: Po weryfikacji ręcznej faza i zmiana są gotowe do `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- `shared/date`: `addDays`, `daysBetween` na granicach miesiąca, roku, lutego i zmian czasu.
- `trial-reminder.ts`: okno, opis dni (0/1/2/7), formatowanie daty i kwoty, temat dla jednej i wielu pozycji, kolejność pozycji, escapowanie.
- `MailService`: wynik `sendToUser` dla sukcesu, błędu serwera, odrzuconego adresata i nieudanego zapisu audytu.

### Integration Tests:

- `test/subscriptions/trial-reminder.e2e-spec.ts`: granice okna (`today`, `today+7` w oknie; `yesterday`, `today+8` poza), jeden mail zbiorczy, idempotencja drugiego przebiegu, ponowne uzbrojenie po `PUT`, zablokowane konto, zwolnienie po błędzie transportu i ponowienie.
- Cały `npm run test:e2e` jako strażnik zmiany w `close()`.

### Manual Testing Steps:

1. Lokalnie dodać przez UI trial kończący się za 3 dni i drugi za 7 dni; uruchomić `npm run start:dev`; sprawdzić, że API przyjmuje żądania od razu, a jeden mail zawiera obie pozycje.
2. Zrestartować API → brak drugiego maila.
3. Edytować datę końca jednego triala → po restarcie przychodzi mail z tą jedną pozycją.
4. Z prawdziwym SMTP na własny adres sprawdzić wygląd w Gmailu.

## Performance Considerations

Skala MVP jest mała: zapytanie korzysta z indeksu `(status, trial_end_date)`, a maile idą po kolei, po jednym na użytkownika. Wysyłka nie blokuje startu, więc czas SMTP nie wpływa na deploy.

## Migration Notes

Kolumna nullable, bez backfillu. Pierwszy start po deployu wyśle przypomnienia o wszystkich trialach, które już są w oknie 7 dni — zgodnie z regułą („nadrabianie”). Po przywróceniu bazy z dumpu znaczniki z nowszej wersji znikają; wysłane w niej maile mogą wtedy wyjść drugi raz (ryzyko ograniczone startem w tle, który nie wywołuje rollbacku).

## References

- Roadmapa: `context/foundation/roadmap.md` S-06; PRD FR-013, FR-014
- Wzorce: `context/foundation/backend-patterns.md` „Cykl życia i zadania cykliczne”, „Maile”
- Poprzedni slice: `context/archive/2026-11-15-subscription-lifecycle/plan.md`
- Ryzyko: `context/foundation/infrastructure.md` (pre-mortem, Risk Register: „Przypomnienia o trialu przesunięte przez DST / zgubione przy restarcie”)
- Testy: `context/foundation/test-plan.md` §6.3, §6.4

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Elementy bazowe

#### Automated

- [x] 1.1 Migracja wygenerowana, przejrzana i zastosowana; ponowny migration:generate nie widzi zmian — e6e8e62
- [x] 1.2 Testy jednostkowe przechodzą (npm test) — e6e8e62
- [x] 1.3 Lint i typy (npm run lint && npm run build) — e6e8e62

#### Manual

- [x] 1.4 Treść przykładowego maila czyta się naturalnie dla jednej i trzech pozycji — e6e8e62

### Phase 2: Job przypomnień

#### Automated

- [x] 2.1 Testy jednostkowe przechodzą (npm test)
- [x] 2.2 Nowy plik e2e trial-reminder przechodzi
- [x] 2.3 Cały zestaw e2e przechodzi (npm run test:e2e)
- [x] 2.4 Lint i typy (npm run lint && npm run build)
- [x] 2.5 Sabotaż: bez IS DISTINCT FROM czerwony drugi przebieg, bez zwolnienia czerwone konto C

#### Manual

- [x] 2.6 start:dev startuje bez czekania na wysyłkę, a mail ma poprawne pozycje, daty, kwoty i link
- [x] 2.7 Restart API tego samego dnia nie wysyła drugiego maila

### Phase 3: Dokumentacja i weryfikacja ręczna

#### Automated

- [ ] 3.1 Pełny zestaw nadal zielony (npm test, test:e2e, lint)

#### Manual

- [ ] 3.2 Prawdziwy mail dociera do Gmaila przez SMTP MyDevil z polskimi znakami i linkiem
- [ ] 3.3 Po deployu health-check przechodzi przy pierwszej próbie, log pokazuje przebieg przypomnień
- [ ] 3.4 Opisy w backend-patterns, test-plan i CLAUDE.md zgadzają się z kodem
