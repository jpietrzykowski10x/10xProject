# Przyczyny porażek jobów i maili oraz ślad audytowy — plan implementacji

## Overview

Wysyłka maila do użytkownika ma zwracać przyczynę zamiast jednego `false`. Błąd bazy przy sprawdzaniu konta przestaje udawać „brak konta”: zostawia wiersz `FAILED` i alarm. Joby zapisują w rejestrze nazwany krok i kod porażki. Przypomnienia o trialu odróżniają konta pominięte od prawdziwych porażek i od przypomnień straconych.

Trwały wiersz w `admin_audit` zostawiają:
- usunięcie konta;
- wyszukiwanie admina;
- odmowa rangi;
- zmiana roli przez CLI.

CLI ról przestaje zgłaszać zmianę, której nie było. Przy okazji dopisujemy zaległe testy z przeglądów S-11.

Plan realizuje PRD v2 FR-024 i roadmapę S-16. Zamyka ustalenia J5, J7, J8, J9, J11, J13, J14, J15, L8, A1 (część trwała), A3, A5, A6, A7, A8, A10 i P13 z audytu `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md`. Dokłada też nowe znalezisko z researchu: bramkę maila o blokadzie.

## Current State Analysis

Pełne kotwice: `context/changes/failure-causes-and-audit-trail/research.md`. Ścieżki względne do `backend-subtracker/src/`.

- **Mail.**
  - `MailService.sendToUser` zwraca `Promise<boolean>` (`mail/services/mail.service.ts:64-86`).
  - `accountExists` (:151-160) zamienia błąd bazy w `false`, więc mail ginie bez wiersza i alarmu, a w logu jest `warn` „no account”. Ta reguła jest zapisana w `context/foundation/backend-patterns.md`, w sekcji „Mail tylko na adres istniejącego konta”.
  - Wynik czytają tylko przypomnienia (`subscriptions/services/trial-reminder.service.ts:147-169`). Pozostali wywołujący go ignorują: `auth/services/auth.service.ts:310-336` i `auth/services/account-access.service.ts:166-181`.
  - Bramka „mail o blokadzie raz na godzinę” (`auth/services/auth.service.ts:340-351`) liczy tylko wiersze `SENT`.
- **Joby.**
  - `JobRunService.track` (`jobs/job-run.service.ts:48-105`) zapisuje `outcome` i `counters`. Z wyjątku zostaje samo `message`, i to tylko w logu (:66, :86).
  - Encja `job_run` nie ma kolumny na przyczynę.
  - Alarm `jobs/job-run-alert.ts:16-42` dla `partial` obiecuje ponowienie.
  - Przypomnienia:
    - liczą do `usersFailed` każde `false` i każdy wyjątek (:104-116);
    - błąd zwolnienia znacznika gubi przypomnienie (J5);
    - log nie ma UUID ani kroku (J7).
  - Cykl życia: krok przesuwania dat pada na pierwszym złym wierszu bez id i bez liczników (`subscriptions/services/subscription-lifecycle.service.ts:59-97`).
  - Podsumowanie `partial` i linie „Skipped …” to `warn`, więc trafiają do stdout (`out.log`).
- **Audyt.**
  - `admin_audit` (`admin/entities/admin-audit.entity.ts:12-28`): `actor_id` i `target_id` NOT NULL, bez kolumny kontekstu, `action` varchar z enumem tylko w TS (`admin/admin-audit.types.ts:2-8`).
  - Odmowa rangi wycofuje się razem z transakcją akcji (`admin/services/admin-users.service.ts:174-203`). S-13 zostawił po niej tylko linię `Denials`.
  - Nie zostawiają śladu:
    - wyszukiwanie (`admin/services/admin-users.service.ts:99-127`);
    - usunięcie konta (`auth/services/account-deletion.service.ts:18-45`);
    - zmiany ról przez CLI (`cli/role-script.ts:44`, `users/role-grants.ts:22-89`).
- **Zaległe testy z S-11.**
  - Nie ma testu ścieżki `recordSkipped` przy fladze `running` w trzech schedulerach.
  - `watchdog/watchdog-policy.spec.ts:71-105` liczy granicę 12 h ze stałej `REMIND_EVERY_HOURS`.

## Desired End State

- **`sendToUser`** zwraca `MailOutcome`:
  - `sent`;
  - `no_account`;
  - `blocked`;
  - `lookup_failed`: wiersz `FAILED` i alarm w oknie per typ z S-12;
  - `send_failed`;
  - `recipient_typo`.

  Każdy wynik ma jedną linię logu z typem maila i przyczyną, bez adresu. Linia `warn` „no account” pojawia się tylko przy `no_account`.
- **Bramka maila o blokadzie:** godzina liczy się od ostatniego wiersza `SENT` albo `FAILED`.
- **Przebieg joba:**
  - `failed` ma w `job_run.failure` wartość `<krok>: <kod>`, np. `roll_billing_dates: 57014`.
  - Ta sama przyczyna jest w linii `error` (ze stosem) i w mailu do operatora.
  - Treść komunikatu błędu nie trafia ani do bazy, ani do maila.
- **Przypomnienia o trialu:**
  - konto usunięte albo zablokowane w trakcie oraz literówka liczą się jako `usersSkipped`, nie jako porażka; literówka nie zwalnia znacznika;
  - nieudane zwolnienie znacznika liczy się jako `remindersLost`, daje `partial`, linię `error` z UUID użytkownika i krokiem oraz alarm, który mówi, że przypomnienie przepadło.
- **Cykl życia:** zły wiersz w kroku przesuwania dat daje linię `error` z id subskrypcji i `billingRollFailed += 1`. Pozostałe wiersze są przetwarzane dalej, a przebieg kończy się `partial`.
- **Poziom logu:** podsumowanie `partial` i linie „Skipped …” idą jako `error`, czyli do `err.log`.
- **`admin_audit`** dostaje wiersze:
  - `ACCOUNT_DELETED`: aktor i cel to UUID konta, w tej samej transakcji co usunięcie; do tego linia `Account <uuid> deleted`;
  - `SEARCH`: cel `null`, `details {status, qLength, results}`, bez `q`;
  - `DENIED`: `details {action, why}`, zapisywany po wycofaniu transakcji, tylko dla odmowy rangi `admin_cannot_manage`;
  - `ROLE_GRANTED` i `ROLE_REVOKED`: aktor `null` (CLI), `details {role}`, tylko przy faktycznej zmianie.
- **CLI ról:**
  - wypisuje „already granted” / „was not granted”, gdy nic się nie zmieniło;
  - odmawia nadania roli nieaktywnej;
  - przy błędzie podaje kod PG;
  - ponownie rzucony błąd ma `cause`.
- **Mail o dostępie do konta** (blokada, odblokowanie, reset sesji) ma linię logu z id wiersza `admin_audit` i wynikiem wysyłki.
- **Jedna migracja** dodaje `job_run.failure` i zmienia `admin_audit`: kolumny id nullable, nowa kolumna `details jsonb`.
- **Dokumentacja:** `backend-patterns.md` i `CLAUDE.md` opisują nowe reguły.
- **Testy:** zaległe testy z S-11 są dopisane.

### Key Discoveries:

- Wartości `admin_audit.action` i `job_run.outcome` to varchar, więc nowe akcje nie wymagają migracji. Migracji wymagają nowe kolumny i zdjęcie NOT NULL (`database/migrations/1795264062710-AdminRolesAndAudit.ts:10`).
- Lokalne e2e synchronizują bazę dev (`backend-subtracker/vitest.config.e2e.ts:14`), więc fazy 1–3 da się sprawdzić bez migracji. Job `backend-e2e` w CI buduje schemat z `migration:run`, dlatego migracja musi trafić do PR-a przed jego otwarciem (faza 4).
- `src/shared/database/unique-violation.ts` czyta już `driverError.code`. Odczyt kodu PG do opisu porażki dopisujemy w `shared/database/` (`lessons.md`: kod ogólny w `shared/`).
- `test/support/e2e-app.ts:148-152, 224-231`: `failMailTo` odrzuca wysyłkę błędem bez pól SMTP, czyli daje `send_failed`, a nie `recipient_typo`.
- Komunikaty PG mogą cytować wartości (np. `Key (email)=(…) already exists`). Dlatego w `failure` i w alarmie jest tylko krok i kod, a nigdy `message`.

## What We're NOT Doing

- Format logu, wersja i access log (S-14). Tu zmienia się tylko poziom kilku linii.
- Trwałe wiersze dla `role_missing` (zwykły użytkownik na `/admin/*`) i dla odmów stanu 409. Zostają linia `Denials` z S-13 albo brak śladu.
- Zapis `q` z wyszukiwania w jakiejkolwiek postaci.
- Osobna tabela usunięć kont i osobny okres przechowywania dla `admin_audit`.
- Widok audytu w UI. Operator czyta SQL.
- `messageId` w wierszu `mail` i monitorowana skrzynka zwrotna (J12).
- Wiersz `mail` PENDING przed wysyłką i shutdown hooks (L9).
- Transakcja obejmująca kroki 1–2 cyklu życia. Kroki zostają osobnymi warunkowymi `UPDATE`, zgodnie z `backend-patterns.md`.
- Indeksy na `admin_audit`. Żadne zapytanie aplikacji ich nie potrzebuje (`lessons.md`).
- Zmiany we froncie.

## Implementation Approach

Fazy idą według modułów.
- **Faza 1** zmienia kontrakt `MailService`. Na nim opiera się faza 2.
- **Faza 2** przebudowuje rejestr i trzy joby.
- **Faza 3** rozszerza `admin_audit` i CLI ról.
- **Faza 4** generuje jedną migrację na koniec slice'u (`lessons.md`), aktualizuje dokumenty i wdraża.

Każda faza kończy się zielonymi testami jednostkowymi i e2e na bazie dev.

## Critical Implementation Details

- **Wiersz `DENIED` po wycofaniu transakcji.** Hook rangi rzuca odmowę wewnątrz `withinTransaction`, więc wiersz w tej transakcji by przepadł. Zapis robi `AdminUsersService` w `catch` wokół `AccountAccessService.change`, osobną instrukcją. Zapis ma `await`, a jego błąd tylko loguje. Potem rzuca się ten sam wyjątek z `withDenial`, żeby linia `Denials` i 403 zostały bez zmian.
- **`lookup_failed` i drugi odczyt konta.** Wiersz `FAILED` przechodzi przez `saveAudit`, który przed zapisem sprawdza konto ponownie. Gdy baza dalej nie odpowiada albo konta nie ma, wiersz dostaje `ANONYMIZED_RECIPIENT`. Zostaje to bez zmian: zasada z S-10 („wiersz nie przywraca adresu usuniętego konta”) jest ważniejsza niż pełny adres w wierszu porażki. Wiersz `FAILED` powstaje tylko wtedy, gdy baza przyjmie zapis. Przy pełnej awarii bazy zostaje sam alarm z `id: brak (nie zapisano wiersza audytu)`. Drugi odczyt w `saveAudit` nie loguje własnej linii `error`, więc jeden `lookup_failed` daje jedną linię błędu odczytu.
- **Zapis do `admin_audit` spoza modułu admin.** `AdminModule` importuje `AuthModule`, więc `AdminAuditService` nie da się wstrzyknąć do auth bez cyklu modułów. CLI ról nie uruchamia Nesta. Dlatego zapis to zwykła funkcja `insertAdminAudit(manager, entry)` z `admin/admin-audit-insert.ts`, bez DI. Używają jej `AdminAuditService.record`, usunięcie konta i `role-grants.ts`, każde z `manager` swojej transakcji.

## Phase 1: Wynik wysyłki maila

### Overview

`sendToUser` mówi, dlaczego mail nie wyszedł. Błąd bazy przy sprawdzaniu konta zostawia ślad i daje alarm. Bramka maila o blokadzie nie ponawia wysyłki po porażce.

### Changes Required:

#### 1. Typ wyniku

**File**: `backend-subtracker/src/mail/mail.types.ts`

**Intent**: Zamknięty zbiór przyczyn, wspólny dla serwisu i wywołujących.

**Contract**:
- `export type MailOutcome = 'sent' | 'no_account' | 'blocked' | 'lookup_failed' | 'send_failed' | 'recipient_typo'`;
- pomocnik `isDelivered(outcome): outcome is 'sent'` dla wywołujących, którym wystarczy tak/nie.

#### 2. `MailService.sendToUser`

**File**: `backend-subtracker/src/mail/services/mail.service.ts`, `backend-subtracker/src/mail/services/mail.service.spec.ts`

**Intent**: Rozróżnić cztery dzisiejsze przyczyny `false`. Błąd odczytu konta ma iść ścieżką awarii: wiersz `FAILED` i alarm.

**Contract**:
- `sendToUser(type, to, content): Promise<MailOutcome>`; nadal nie rzuca.
- Sprawdzenie konta zwraca jedną z trzech wartości `present | missing | lookup_failed`. Rozróżnienie `no_account` / `blocked` dla typów spoza `ACCOUNT_ACCESS_MAIL_TYPES` wymaga odczytu `isActive`, a nie samego `exists`.
- Wyniki i ich skutki:
  - `no_account`: linia `warn` `Skipped <TYPE> mail: no account with this address`; bez wiersza i bez alarmu.
  - `blocked`: linia `log` `Skipped <TYPE> mail: the account is blocked`; bez wiersza i bez alarmu.
  - `lookup_failed`:
    - linia `error` `Checking the recipient of <TYPE> mail failed (code: <kod PG|unknown>)`;
    - wiersz `FAILED` z `error_message = 'account lookup failed'`, przez `saveAudit`, o ile baza przyjmie zapis (ponowne sprawdzenie konta w `saveAudit` bez osobnej linii `error`);
    - alarm przez `alertOperatorAboutFailure` w tym samym oknie per typ.
  - `send_failed` i `recipient_typo`: wynik z `deliver`, logi i alarm jak po S-12.
- Testy:
  - po jednym na każdy wynik;
  - `lookup_failed` zapisuje wiersz i alarmuje;
  - zablokowane konto przy typie dostępu do konta dostaje mail;
  - istniejący test „treats a failed account lookup as a missing account” zastąpiony testem nowej reguły.

#### 3. Wywołujący

**File**: `backend-subtracker/src/auth/services/auth.service.ts` (+ spec), `backend-subtracker/src/auth/services/account-access.service.ts` (+ spec), `backend-subtracker/src/subscriptions/services/trial-reminder.service.ts`

**Intent**: Dostosować typy. Zachowanie przypomnień zostaje na razie jak dziś: tylko `sent` jest sukcesem, a każda inna wartość zwalnia znacznik. Nowe liczenie wchodzi w fazie 2.

**Contract**: mocki z `Promise<MailOutcome>`; w przypomnieniach `isDelivered(outcome)` w miejscu dzisiejszego `boolean`.

#### 4. Bramka maila o blokadzie

**File**: `backend-subtracker/src/auth/services/auth.service.ts`, `backend-subtracker/test/auth/account-access.e2e-spec.ts`

**Intent**: Porażka wysyłki zamyka bramkę tak samo jak sukces, więc awaria SMTP nie daje ponownej próby przy każdym żądaniu linku.

**Contract**:
- `blockedMailSentRecently` szuka wiersza `ACCOUNT_BLOCKED` ze statusem `SENT` albo `FAILED` z ostatniej godziny;
- nazwa i komentarz mówią „attempted”;
- test e2e: nieudany mail o blokadzie (`failMailTo`) i drugie żądanie linku w ciągu godziny nie dają drugiego wiersza.

#### 5. Testy e2e przypinające wynik

**File**: `backend-subtracker/test/auth/*.e2e-spec.ts`, `backend-subtracker/test/subscriptions/trial-reminder.e2e-spec.ts`, `backend-subtracker/test/jobs/job-run.e2e-spec.ts`

**Intent**: Istniejące e2e przechodzą z nowym kontraktem. Zmiany tylko tam, gdzie test sprawdza dokładną treść logu albo typ.

**Contract**: bez zmian w liczbie wierszy `mail` i w odpowiedziach HTTP.

### Success Criteria:

#### Automated Verification:

- Testy poczty i auth przechodzą: `npx vitest run src/mail src/auth`
- Celowe uszkodzenie: powrót do „błąd odczytu = brak konta” albo bramka tylko dla `SENT` czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie przy błędnym `SMTP_PASSWORD`, z kontem zablokowanym w `subtracker-db-dev`, dwie prośby o link w ciągu godziny dają jeden wiersz `ACCOUNT_BLOCKED` `FAILED` i jeden alarm

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2. Przywróć poprawne `SMTP_PASSWORD` po teście.

---

## Phase 2: Przyczyny porażek jobów

### Overview

Rejestr i alarm mówią, który krok joba padł i z jakim kodem. Przypomnienia i cykl życia liczą pominięte, stracone i błędne wiersze osobno. Dochodzą zaległe testy z S-11.

### Changes Required:

#### 1. Opis porażki z błędu bazy

**File**: `backend-subtracker/src/shared/database/failure-code.ts` (+ `failure-code.spec.ts`)

**Intent**: Wspólne, bezpieczne skrócenie błędu do kodu, bez treści, która może cytować dane.

**Contract**:
- `failureCodeOf(error: unknown): string` zwraca `driverError.code` (albo `code` błędu), gdy to string;
- w przeciwnym razie nazwę klasy błędu (`error.name`), a dla wartości niebędących błędem `unknown`;
- testy: `QueryFailedError` z `57014`, zwykły `Error`, `TypeError`, string.

#### 2. Krok porażki w `track`

**File**: `backend-subtracker/src/jobs/job-run.types.ts`, `backend-subtracker/src/jobs/job-run.service.ts` (+ spec), `backend-subtracker/src/jobs/entities/job-run.entity.ts`, `backend-subtracker/src/jobs/job-run-alert.ts` (+ spec)

**Intent**: Serwis joba oznacza krok, a `track` zapisuje krok i kod w rejestrze, w logu i w alarmie.

**Contract**:
- `class JobStepError extends Error` z polem `step: string` i `cause` (oryginalny błąd), oraz pomocnik `inStep(step, fn)`, który opakowuje wyjątek w `JobStepError`;
- `job_run.failure`: varchar(200), nullable, `<step>: <failureCodeOf(cause)>`; bez `JobStepError` ma wartość `unknown: <kod>`;
- linia `error`: `Job <job> (<trigger>) for <day>: failed in <ms> ms (<failure>)` plus stos jako drugi argument loggera;
- `JobRunReport` dostaje opcjonalne `lost?: boolean`;
- alarm:
  - przy `failed` linia `przyczyna: <failure>`;
  - przy `partial` zdanie o ponowieniu tylko wtedy, gdy nic nie przepadło; z `lost` zdanie „część pracy przepadła, szczegóły w err.log”;
- podsumowanie `partial` i `recordSkipped` (linie „Skipped …” w schedulerach) jako `error` (J13).

#### 3. Cykl życia i sprzątanie

**File**: `backend-subtracker/src/subscriptions/services/subscription-lifecycle.service.ts` (+ nowy spec), `backend-subtracker/src/subscriptions/subscription-lifecycle.scheduler.ts`, `backend-subtracker/src/auth/services/auth-cleanup.service.ts`, `backend-subtracker/src/auth/auth-cleanup.scheduler.ts`

**Intent**: Nazwane kroki. Zły wiersz nie blokuje reszty i jest wskazany id.

**Contract**:
- kroki cyklu życia: `trial_to_active`, `cancelled_pending_to_cancelled`, `roll_billing_dates`;
- kroki sprzątania: `magic_link_tokens`, `expired_sessions`, `revoked_sessions`, nazwy dopasowane do trzech `DELETE`;
- `roll_billing_dates`: `try/catch` per wiersz, linia `error` `Rolling the billing date of subscription <uuid> failed (code: <kod>)`, licznik `billingRollFailed`;
- `advance` zwraca `partial: billingRollFailed > 0`;
- błąd odczytu listy wierszy rzuca `JobStepError('roll_billing_dates')`;
- test jednostkowy (`subscription-lifecycle.service.spec.ts`, nowy): mock repozytorium, w którym `execute` na 2. z 3 zaległych wierszy rzuca `QueryFailedError` z kodem `22008`. Wynik: `billingDatesRolled: 2`, `billingRollFailed: 1`, `partial: true`, linia `error` z id tego wiersza.

#### 4. Przypomnienia o trialu

**File**: `backend-subtracker/src/subscriptions/services/trial-reminder.service.ts`, `backend-subtracker/src/subscriptions/trial-reminder.scheduler.ts`, `backend-subtracker/test/subscriptions/trial-reminder.e2e-spec.ts`

**Intent**: Porażką jest tylko to, co zostanie ponowione albo przepadło. Konto, które zniknęło albo zostało zablokowane, i zły adres to pominięcia.

**Contract**:
- wynik `remind` per użytkownik:
  - `sent` → `remindersSent += n`;
  - `no_account` / `blocked` → zwolnienie znacznika, `usersSkipped += 1`;
  - `recipient_typo` → znacznik zostaje, `usersSkipped += 1`, linia `warn` z UUID użytkownika;
  - `send_failed` / `lookup_failed` → zwolnienie znacznika, `usersFailed += 1`;
  - błąd zwolnienia → `remindersLost += 1` i linia `error` `Releasing the trial reminder of user <uuid> failed (code: <kod>); the reminder for <data> is lost`;
- `catch` per użytkownik loguje UUID, krok (`reserve | send | release`) i kod (J7);
- scheduler: `partial: usersFailed > 0 || remindersLost > 0`, `lost: remindersLost > 0`;
- e2e:
  - konto zablokowane między rezerwacją a wysyłką liczy się do `usersSkipped`, a przebieg ma `success`. Rezerwacja filtruje po `OWNER_IS_ACTIVE`, więc blokada przed nią daje tylko pominięcie bez licznika. Test używa `vi.spyOn(MailService.prototype, 'sendToUser')`: spy najpierw ustawia `is_active = false` w bazie, potem woła oryginał;
  - mail nieudany (`failMailTo`) nadal daje `usersFailed` i `partial`.

#### 5. Zaległe testy z S-11

**File**: `backend-subtracker/test/jobs/job-run.e2e-spec.ts`, `backend-subtracker/src/watchdog/watchdog-policy.spec.ts`

**Intent**: Pokryć ścieżkę „poprzedni przebieg trwa” i przypiąć granicę 12 h dosłownymi czasami (roadmapa S-16, Notes).

**Contract**:
- trzy testy, po jednym na scheduler (cykl życia, sprzątanie, przypomnienia):
  - pierwszy przebieg trzymany otwarty (`mockImplementationOnce(() => gate)`);
  - drugie `daily()` zostawia wiersz `skipped`;
  - dla przypomnień drugie wywołanie i `idle()` rozwiązują się dopiero po puszczeniu pierwszego;
- e2e `failed` z kolumną `failure` = `trial_to_active: <kod>`. Podmiana całego `advance` (jak dziś w `job-run.e2e-spec.ts:112-115`) omija `inStep` i dałaby `unknown: Error`. Dlatego spy na pierwszym `execute` kroku 1 rzuca `QueryFailedError` z kodem `57014`, a test oczekuje `trial_to_active: 57014`;
- watchdog w `describe('decide')`: `at(11 * 60 + 59)` daje `none`, a `at(12 * 60)` daje `remind-down`.

### Success Criteria:

#### Automated Verification:

- Testy jobów, rejestru i watchdoga przechodzą: `npx vitest run src/jobs src/shared/database src/watchdog src/subscriptions`
- Celowe uszkodzenie: `failure` z `error.message` zamiast kodu albo przypomnienie dla zablokowanego konta liczone jako porażka czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie `npm run start:dev` z aktywną subskrypcją o `next_billing_date = '0001-01-01 BC'` (ustawioną SQL-em w `subtracker-db-dev`; tekst daty z `BC` daje w `rolledBillingDate` niepoprawną datę i `UPDATE` pada) daje wiersz `job_run` `partial` z `billingRollFailed: 1`, linię `error` z id subskrypcji i alarm do operatora. Gdy ta wartość nie wywoła błędu, ten sam efekt da tymczasowy `throw` dla jednego id w pętli (cofnięty po teście). Po teście przywróć datę.

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Ślad audytowy

### Overview

`admin_audit` zapisuje usunięcie konta, wyszukiwanie, odmowę rangi i zmiany ról. CLI ról mówi prawdę o tym, co zrobiło.

### Changes Required:

#### 1. Encja i serwis audytu

**File**: `backend-subtracker/src/admin/entities/admin-audit.entity.ts`, `backend-subtracker/src/admin/admin-audit.types.ts`, `backend-subtracker/src/admin/admin-audit-insert.ts` (nowy), `backend-subtracker/src/admin/services/admin-audit.service.ts` (+ spec)

**Intent**: Jedna tabela śladu z kontekstem, który nie jest daną osobową.

**Contract**:
- `actor_id` uuid nullable (`null` = CLI), `target_id` uuid nullable, `details` jsonb nullable;
- nowe akcje: `SEARCH`, `DENIED`, `ACCOUNT_DELETED`, `ROLE_GRANTED`, `ROLE_REVOKED`;
- typ `details` per akcja:
  - `SEARCH`: `{ status, qLength, results }`;
  - `DENIED`: `{ action, why }`;
  - `ROLE_*`: `{ role }`;
- `insertAdminAudit(manager: EntityManager, entry): Promise<string>` w `admin/admin-audit-insert.ts`: zwykła funkcja bez DI, jedyne miejsce zapisu wiersza w transakcji wywołującego (uzasadnienie w Critical Implementation Details);
- `record(manager, entry)` deleguje do `insertAdminAudit` i zwraca id wiersza;
- `recordOutside(entry)` dla wierszy spoza transakcji akcji: z `await`, nigdy nie rzuca, błąd loguje jako `error`.

#### 2. Wyszukiwanie i odmowa rangi

**File**: `backend-subtracker/src/admin/services/admin-users.service.ts`, `backend-subtracker/test/admin/*.e2e-spec.ts`

**Intent**: Każde wyszukiwanie i każda odmowa rangi zostawia wiersz.

**Contract**:
- `search` po odczycie zapisuje `SEARCH` z `status`, długością `q` (0 przy braku) i liczbą wyników;
- `change` łapie odmowę z kodem `admin_cannot_manage`, zapisuje `DENIED` przez `recordOutside` (aktor, cel, `{action, why}`) i rzuca ten sam wyjątek dalej;
- inne wyjątki przechodzą bez wiersza;
- e2e:
  - wyszukiwanie zostawia wiersz bez `q` w `details`;
  - admin blokujący admina dostaje 403, a w tabeli jest wiersz `DENIED` i nie ma wiersza `BLOCK`;
  - linia `Denials` z S-13 zostaje.

#### 3. Usunięcie konta

**File**: `backend-subtracker/src/auth/services/account-deletion.service.ts`, `backend-subtracker/test/auth/account-deletion.e2e-spec.ts`

**Intent**: Trwały dowód, że i kiedy konto zostało usunięte, bez adresu.

**Contract**:
- w tej samej transakcji przed `DELETE user` wiersz `ACCOUNT_DELETED` (aktor = cel = UUID konta) przez `insertAdminAudit(manager, …)`, bez wstrzykiwania `AdminAuditService` (cykl modułów);
- po commicie linia `log` `Account <uuid> deleted`;
- e2e: po usunięciu wiersz istnieje, a w `details` i w logu nie ma adresu.

#### 4. Powiązanie maila o dostępie z akcją (A8)

**File**: `backend-subtracker/src/auth/services/account-access.service.ts`, `backend-subtracker/src/admin/services/admin-users.service.ts`

**Intent**: Wynik maila o blokadzie, odblokowaniu i resecie sesji da się powiązać z wierszem audytu.

**Contract**:
- hook akcji zwraca id wiersza `admin_audit`, a `notify` dostaje go razem z adresem;
- po wysyłce linia `log` `<TYPE> mail for admin audit <id>: <outcome>`.

#### 5. CLI ról

**File**: `backend-subtracker/src/users/role-grants.ts` (+ spec), `backend-subtracker/src/cli/role-script.ts`

**Intent**: Komunikat odpowiada temu, co zaszło. Rola nieaktywna nie jest nadawana. Każda zmiana zostawia ślad.

**Contract**:
- `grantRole` / `revokeRole` zwracają `'granted' | 'already_granted'` oraz `'revoked' | 'not_granted'`;
- nadanie roli z `is_active = false` daje `Error('Role X is inactive')`;
- `INSERT … ON CONFLICT DO NOTHING RETURNING` decyduje o `granted`, `affected` o `revoked`;
- `grantRole` i `revokeRole` dostają `dataSource.transaction`, bo dziś działają na `dataSource` bez transakcji. Wewnątrz idą `INSERT`/`DELETE` i wiersz `ROLE_GRANTED` / `ROLE_REVOKED` (aktor `null`, cel = UUID konta, `{role}`) przez `insertAdminAudit(manager, …)`, tylko przy faktycznej zmianie. Sprawdzenie superadmina i `SINGLE_SUPER_ADMIN_INDEX` działają jak dziś;
- `role-script.ts`: `AdminAudit` dopisany do `entities` DataSource CLI (dziś `[User, Role, UserRole]`, bez niego zapis rzuci „No metadata”);
- `23505` zamieniany na komunikat z `cause` (P13);
- `role-script.ts`:
  - wypisuje komunikat według wyniku;
  - przy błędzie `<message> (code: <failureCodeOf>)` (A10);
  - kod wyjścia 1 tylko przy błędzie.

### Success Criteria:

#### Automated Verification:

- Testy audytu, admina i ról przechodzą: `npx vitest run src/admin src/users src/auth`
- Celowe uszkodzenie: zapis `DENIED` w transakcji akcji albo `q` w `details` czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie dwa razy `npm run admin:grant -- <adres>` daje „granted”, potem „already granted”, a w `admin_audit` jest jeden wiersz `ROLE_GRANTED`
- Lokalnie wyszukiwanie na `/admin/users` zostawia wiersz `SEARCH` bez wpisanego tekstu

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 4.

---

## Phase 4: Migracja, dokumenty i produkcja

### Overview

Schemat referencyjny i produkcyjny dostaje zmiany z faz 2–3. Dokumenty opisują nowe reguły. Zmiana trafia na serwer.

### Changes Required:

#### 1. Migracja

**File**: `backend-subtracker/src/database/migrations/<timestamp>-FailureCausesAndAuditTrail.ts`

**Intent**: Jedna migracja na koniec slice'u (`lessons.md`), wygenerowana względem `subtracker-db`.

**Contract**:
- `npm run migration:generate -- FailureCausesAndAuditTrail`;
- przegląd pliku: tylko `job_run.failure`, `admin_audit.actor_id` i `target_id` `DROP NOT NULL`, `admin_audit.details`;
- bez nowych FK i indeksów;
- `npm run migration:run` na `subtracker-db`.

#### 2. Dokumenty

**File**: `context/foundation/backend-patterns.md`, `CLAUDE.md`

**Intent**: Kolejny slice zna nowe kontrakty.

**Contract**:
- `backend-patterns.md`:
  - „Mail tylko na adres istniejącego konta”: `MailOutcome`, `lookup_failed` z wierszem i alarmem zamiast „błąd = brak konta”;
  - „Cykl życia i zadania cykliczne”: `JobStepError`, `job_run.failure` bez treści komunikatu, `partial`/`skipped` jako `error`, liczniki przypomnień (`usersSkipped`, `remindersLost`) i `billingRollFailed`;
  - sekcja o rolach i adminie: akcje `admin_audit`, `details` bez danych osobowych, `DENIED` poza transakcją, aktor `null` = CLI, wiersz usunięcia konta;
- `CLAUDE.md` (poza blokiem 10x): jedno zdanie o `MailOutcome` i jedno o nowych wierszach `admin_audit`.

### Success Criteria:

#### Automated Verification:

- Migracja przechodzi na bazie referencyjnej: `npm run migration:run`, a potem `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- CI zielone na PR (`backend`, `backend-e2e`, `frontend`, `browser-e2e`, `deploy-scripts`)

#### Manual Verification:

- Po deployu API `curl localhost:<PORT_API>/health` zwraca 200, a w logu deployu migracja `FailureCausesAndAuditTrail` jest zastosowana
- Na produkcji wyszukiwanie w `/admin/users` zostawia wiersz `SEARCH` w `admin_audit` (zapytanie SQL na serwerze)
- Następnego dnia wiersze `job_run` trzech jobów mają `outcome` `success` i `failure` `null`

**Implementation Note**: Po wdrożeniu i ręcznych testach na produkcji zatrzymaj się na potwierdzenie przed `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `MailService`: każdy `MailOutcome`, `lookup_failed` z wierszem i alarmem, zablokowane konto przy typach dostępu do konta.
- `failureCodeOf`: kod PG, klasa błędu, wartość niebędąca błędem.
- `JobRunService`: `failure` z `JobStepError` i bez niego, alarm `failed` z przyczyną, alarm `partial` z `lost`, poziom `error` dla `partial` i `skipped`.
- `job-run-alert`: oba warianty zdania dla `partial`.
- `SubscriptionLifecycleService`: zły wiersz w `roll_billing_dates` (2. z 3) daje `billingRollFailed: 1`, `partial` i przetwarza pozostałe.
- `AdminAuditService`: `recordOutside` nie rzuca przy błędzie zapisu.
- `role-grants`: `already_granted`, `not_granted`, rola nieaktywna, wiersz audytu tylko przy zmianie.
- `watchdog-policy`: granica 11 h 59 min i 12 h.

### Integration Tests:

- Bramka maila o blokadzie po nieudanej wysyłce.
- Przypomnienie dla konta zablokowanego w trakcie: `usersSkipped`, przebieg `success`.
- Trzy schedulery: drugi przebieg w trakcie pierwszego zostawia wiersz `skipped`.
- `job_run.failure` = `trial_to_active: 57014` przy porażce kroku (spy na `execute`, nie na `advance`).
- Wiersze `SEARCH`, `DENIED` (bez `BLOCK`) i `ACCOUNT_DELETED`.

### Manual Testing Steps:

1. Błędne `SMTP_PASSWORD` i zablokowane konto: dwie prośby o link dają jeden wiersz `FAILED` i jeden alarm.
2. Zły wiersz subskrypcji daje przebieg `partial` z `billingRollFailed: 1`.
3. `admin:grant` dwa razy daje „granted”, potem „already granted”, i jeden wiersz audytu.
4. Produkcja: `/health` 200, wiersz `SEARCH` po wyszukiwaniu, następnego dnia joby `success`.

## Performance Considerations

- `SEARCH` dodaje jeden `INSERT` na wyszukiwanie admina (limit 20 wyników, ręczne użycie).
- Odczyt `isActive` zamiast `exists` to to samo zapytanie po indeksowanym adresie.
- Krok `roll_billing_dates` przechodzi wszystkie zaległe wiersze nawet po błędzie, ale ich liczbę ogranicza warunek zaległości jak dziś.

## Migration Notes

- Migracja tylko rozszerza schemat:
  - nowe kolumny nullable;
  - zdjęcie NOT NULL;
  - bez przepisywania danych.
- Poprzednie wydanie działa na nowym schemacie, bo nie czyta nowych kolumn i zawsze wypełnia `actor_id` i `target_id`, więc wycofanie kodu nie wymaga wycofania bazy.
- Na produkcji migracja wchodzi tylko w `deploy.sh` po `pg_dump`.

## References

- Research: `context/changes/failure-causes-and-audit-trail/research.md`
- Audyt: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (§5, §6 pkt 6–8)
- Roadmapa: `context/foundation/roadmap.md`, S-16 (Notes z przeglądów S-11); PRD v2: FR-024
- Poprzednie slice'y:
  - `context/archive/2026-11-22-operator-liveness-alerts/plan.md` (rejestr przebiegów)
  - `context/archive/2026-11-23-request-context-and-denial-reasons/plan.md` (`withDenial`, `Denials`)
  - `context/archive/2026-11-23-independent-alert-channel/plan.md` (okno alarmu per typ)
  - `context/archive/2026-11-21-admin-account-management/plan.md` (`admin_audit`)
  - `context/archive/2026-11-20-account-deletion/plan.md` (anonimizacja)
- Wzorzec helpera bazy: `backend-subtracker/src/shared/database/unique-violation.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wynik wysyłki maila

#### Automated

- [x] 1.1 Testy poczty i auth — 1fbdaff
- [x] 1.2 Celowe uszkodzenie odczytu konta albo bramki czerwieni test — 1fbdaff
- [x] 1.3 Pełne testy backendu — 1fbdaff
- [x] 1.4 Testy e2e backendu — 1fbdaff
- [x] 1.5 Lint i build backendu — 1fbdaff

#### Manual

- [x] 1.6 Lokalnie dwie prośby o link przy złym SMTP dają jeden wiersz `ACCOUNT_BLOCKED` `FAILED` i jeden alarm — 1fbdaff

### Phase 2: Przyczyny porażek jobów

#### Automated

- [x] 2.1 Testy jobów, rejestru i watchdoga
- [x] 2.2 Celowe uszkodzenie `failure` albo liczenia pominiętych czerwieni test
- [x] 2.3 Pełne testy backendu
- [x] 2.4 Testy e2e backendu
- [x] 2.5 Lint i build backendu

#### Manual

- [x] 2.6 Lokalnie zły wiersz subskrypcji daje przebieg `partial` z `billingRollFailed: 1` i alarm

### Phase 3: Ślad audytowy

#### Automated

- [ ] 3.1 Testy audytu, admina i ról
- [ ] 3.2 Celowe uszkodzenie zapisu `DENIED` albo `details` czerwieni test
- [ ] 3.3 Pełne testy backendu
- [ ] 3.4 Testy e2e backendu
- [ ] 3.5 Lint i build backendu

#### Manual

- [ ] 3.6 Lokalnie `admin:grant` dwa razy daje „granted”, „already granted” i jeden wiersz `ROLE_GRANTED`
- [ ] 3.7 Lokalnie wyszukiwanie zostawia wiersz `SEARCH` bez wpisanego tekstu

### Phase 4: Migracja, dokumenty i produkcja

#### Automated

- [ ] 4.1 Migracja na bazie referencyjnej i brak różnic schematu
- [ ] 4.2 CI zielone na PR

#### Manual

- [ ] 4.3 Po deployu `/health` 200 i migracja zastosowana
- [ ] 4.4 Na produkcji wyszukiwanie zostawia wiersz `SEARCH`
- [ ] 4.5 Następnego dnia joby `success` z `failure` `null`
