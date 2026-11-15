# Edycja i usuwanie subskrypcji — plan implementacji

## Overview

Slice S-03 (`roadmap.md`, PRD FR-005 i FR-006): użytkownik poprawia dane istniejącej subskrypcji albo trwale usuwa błędnie dodaną. Backend dostaje `PUT` i `DELETE /subscriptions/:id` z izolacją kont. Na `/subscriptions` panel dodawania zyskuje tryb edycji z tym samym formularzem, a usunięcie potwierdza dialog Material. Usunięcie jest odrębne od anulowania usługi w cyklu życia (FR-013, S-05).

## Current State Analysis

- Backend ma tylko `GET` i `POST /subscriptions` (`backend-subtracker/src/subscriptions/controllers/subscriptions.controller.ts:16-34`). W `src` nie ma `@Param`, `ParseUUIDPipe` ani `NotFoundException`.
- `CreateSubscriptionDto` ma reguły dat zależne od `status` w tym samym obiekcie (`create-subscription.dto.ts:20-57`). Serwis zeruje `trialEndDate`, gdy status nie jest `trial` (`subscriptions.service.ts:81-84`), i sprawdza kategorię przez `findUsable` (:63-68).
- CSRF (`enableCsrfProtection`) i CORS (domyślne metody pakietu `cors`) już przepuszczają PUT i DELETE z zaufanego originu i odrzucają je z obcego. Żadna tabela nie ma FK do `subscription.id`, więc usunięcie dotyczy jednego wiersza. Schemat się nie zmienia, migracji nie ma.
- Bramka `test/routes.e2e-spec.ts:162-177` wymaga dla każdej trasy z `:` wpisu w `EXPECTED_ROUTES` z tytułem istniejącego testu dwóch kont. Test :179-199 woła każdą trasę sesyjną z `UNKNOWN_ID` (`00000000-0000-4000-8000-000000000000`, poprawny UUID) bez ciasteczka i oczekuje 401.
- Frontend:
  - Formularz `SubscriptionForm` umie tylko tworzyć: ma wejście `stickyActions` i wyjście `saved` (`subscription-form.ts:104-105`), a `submit` woła `create()` (:242-265).
  - Strona ma sygnały `adding`/`formMounted`/`addedMessage` (`pages/subscriptions/subscriptions.ts:62-66`) i jeden panel `#new-subscription-panel` z tytułem „Nowa subskrypcja” (`subscriptions.html:70-95`).
  - Tabela nie ma akcji w wierszu. Na telefonie przycisk wiersza rozwija szczegóły (`subscription-table.html:91-170`).
  - W aplikacji nie ma `MatDialog`.

Pełne odwołania: `context/changes/edit-and-delete-subscription/research.md`.

## Desired End State

- `PUT /subscriptions/:id` z ciałem jak w `POST` zastępuje dane subskrypcji zalogowanego użytkownika i zwraca 200 z odpowiedzią w kształcie `SubscriptionResponse`.
- `DELETE /subscriptions/:id` usuwa wiersz i zwraca 204 bez treści.
- Kody błędów (ciasteczko sesji wymagane):
  - id nieistniejące albo należące do innego konta → 404 (ten sam kod w obu przypadkach);
  - id, które nie jest UUID → 400;
  - niepoprawne ciało `PUT` → 400, z tymi samymi regułami co `POST`;
  - kategoria, której użytkownik nie może użyć → 400;
  - brak sesji → 401.
- Na `/subscriptions` każda subskrypcja ma akcje „Edytuj” i „Usuń”: na desktopie w ostatniej kolumnie, na telefonie w rozwiniętych szczegółach.
- „Edytuj” otwiera ten sam panel co dodawanie, z tytułem „Edycja subskrypcji” i wypełnionym formularzem. Zapis wysyła `PUT`, pokazuje „Zapisano zmiany w subskrypcji „X”.” i odświeża listę.
- „Usuń” otwiera dialog z nazwą subskrypcji. Potwierdzenie wysyła `DELETE`, pokazuje „Usunięto subskrypcję „X”.” i odświeża listę.
- Weryfikacja: testy API (z testem dwóch kont), testy komponentów i jeden test Playwright przechodzą w CI (`backend-e2e`, `frontend`, `browser-e2e`).

### Key Discoveries:

- Reguły krzyżowe DTO czytają `status` z tego samego obiektu (`create-subscription.dto.ts:20-21`), więc `PUT` z pełnym ciałem używa `CreateSubscriptionDto` bez zmian.
- Zmiana kategorii przy edycji musi przejść przez `findUsable` (`categories.service.ts:80-87`), bo baza nie wymusza wspólnego właściciela subskrypcji i kategorii (`archive/2026-11-13-backend-e2e-account-isolation/research.md:51`).
- Globalny `ValidationPipe` działa przed serwisem (`app.module.ts:38-45`), więc niepoprawne ciało daje 400 także dla cudzego id. Kolejność „najpierw subskrypcja, potem kategoria” w serwisie sprawia, że cudze id z cudzą kategorią daje 404.
- Kwota z API ma postać `"43.00"`. Pole formularza przyjmuje przecinek i kropkę (`shared/decimal.ts:7`), ale użytkownik ma zobaczyć `43,00`. Daty czytamy przez `parseDateOnly` (`shared/date-only.ts:9`), nigdy przez `new Date(str)`.

## What We're NOT Doing

- Częściowego `PATCH`. Edycja wysyła zawsze komplet pól.
- Ograniczeń przejść statusu. Edycja przyjmuje każdy z 4 statusów z regułami jak przy dodawaniu, a maszyna stanów zostaje w S-05.
- Parametru URL dla edycji ani dodawania. Odświeżenie strony lub „wstecz” zamyka panel, tak jak dziś.
- Przeliczania sum, budżetu i duplikatów (S-04, S-07, S-08). W S-03 lista po zmianie odświeża się z API, a tamte slice'y liczą przy odczycie.
- Kolumny `updatedAt`, wersjonowania ani wykrywania równoczesnych edycji (wygrywa ostatni zapis).
- Usuwania, edycji ani zmiany nazwy kategorii.
- Cofania usunięcia i miękkiego usuwania.
- Czerwonego przycisku w dialogu. Kolor błędu zostaje tylko dla błędów (`archive/2026-11-11-first-subscription-in-list/plan.md:336`), a potwierdzeniem jest sam dialog.
- Nowego testu CSRF dla PUT i DELETE. Ochrona obejmuje każdą metodę poza GET/HEAD/OPTIONS (`backend-patterns.md:57`).

## Implementation Approach

Najpierw kontrakt API z testami, potem frontend w dwóch krokach (edycja, usuwanie), a na końcu jeden test przeglądarkowy i cookbook. Każda faza zostawia działający przyrost. Backend używa ponownie DTO tworzenia i jednego miejsca, które buduje pola wiersza z DTO, żeby reguła `trialEndDate` nie powstała drugi raz. Na froncie formularz dostaje opcjonalne wejście `subscription`: przy `null` tworzy, przy subskrypcji edytuje. Strona zamienia `adding: boolean` na tryb panelu.

## Critical Implementation Details

- **Ponowne utworzenie formularza przy zmianie celu.**
  - Gdy panel zmienia cel (dodawanie → edycja A, edycja A → edycja B, edycja → dodawanie), formularz musi powstać od nowa. Inaczej wartości poprzedniego celu przeciekną do nowego. Klucz instancji: `'new'` dla dodawania albo id subskrypcji, np. `@for (key of [panelKey()]; track key)`.
  - Szkic dodawania przeżywa zwykłe zamknięcie panelu, tak jak dziś. Otwarcie edycji go porzuca.
- **Wypełnienie formularza.** Wartości z subskrypcji ustawia się w `ngOnInit` przed pierwszym renderem, z emisją `valueChanges`, żeby status `trial` włączył `trialEndDate` (`subscription-form.ts:163-169`).

## Phase 1: API edycji i usuwania

### Overview

Dwie nowe trasy po id z izolacją kont, z regułami jak przy tworzeniu i z testami API, których wymaga bramka tras.

### Changes Required:

#### 1. Kontroler

**File**: `backend-subtracker/src/subscriptions/controllers/subscriptions.controller.ts`

**Intent**: Dodać `PUT :id` (200) i `DELETE :id` (204). Id przechodzi przez `ParseUUIDPipe`, więc wartość, która nie jest UUID, daje 400 zanim dotrze do zapytania (Postgres dałby 22P02 → 500).

**Contract**:
- `@Put(':id') update(@CurrentUser() user, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSubscriptionDto): Promise<SubscriptionResponse>`.
- `@Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) remove(@CurrentUser() user, @Param('id', ParseUUIDPipe) id: string): Promise<void>`.

#### 2. Serwis

**File**: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts`

**Intent**: `update` czyta subskrypcję po `{ id, userId }` (brak → `NotFoundException`), potem sprawdza kategorię przez `findUsable` (brak → ten sam 400 co w `create`), nadpisuje pola i zwraca odpowiedź z mappera. `remove` usuwa po `{ id, userId }`; gdy nic nie usunięto, rzuca 404. Budowa pól wiersza z DTO (`amount.toFixed(2)`, `trialEndDate` tylko dla `trial`) przenosi się do jednej prywatnej funkcji używanej przez `create` i `update`.

**Contract**:
- `update(userId: string, id: string, dto: CreateSubscriptionDto): Promise<SubscriptionResponse>`.
- `remove(userId: string, id: string): Promise<void>`.
- Komunikat 404: `'Subscription not found'`, ten sam dla cudzego i nieistniejącego id.
- `createdAt` i `userId` nie zmieniają się przy edycji.

#### 3. Testy API

**File**: `backend-subtracker/test/subscriptions/subscriptions-e2e.ts`

**Intent**: Dodać do `subscriptionRequests` pomocniki `putSubscription(cookie, id, body)` i `deleteSubscription(cookie, id)`, zwracające odpowiedź bez asercji statusu (testy sprawdzają 200, 204, 400 i 404).

**Contract**: wzór istniejących `postSubscription`.

**File**: `backend-subtracker/test/subscriptions/subscriptions.e2e-spec.ts`

**Intent**: Nowe `describe` dla edycji i usuwania na jednym koncie. Przypadki:
- edycja wszystkich pól daje 200, a lista pokazuje nowe wartości z kwotą jako string i niezmienionym `createdAt`;
- zmiana `trial` → `active` zeruje `trialEndDate`, a zmiana `active` → `trial` wymaga daty;
- zmiana na własną kategorię użytkownika daje 200;
- ciało z błędem daje 400 (jeden przypadek z tabeli `POST` wystarczy, reguły pilnuje DTO i jego test jednostkowy);
- `PUT` i `DELETE` z `not-a-uuid` dają 400, a z `UNKNOWN_ID` dają 404;
- `DELETE` daje 204 z pustą treścią, subskrypcji nie ma na liście ani w `repository(Subscription)`, a powtórne `DELETE` daje 404;
- usunięcie jednej subskrypcji nie rusza drugiej ani kategorii.

**File**: `backend-subtracker/test/subscriptions/account-isolation.e2e-spec.ts`

**Intent**: Test dwóch kont: `other` robi `PUT` (z poprawnym ciałem i własną kategorią) i `DELETE` na id `owner`, oba dostają 404, a subskrypcja `owner` ma potem te same pola (odczyt przez `owner` i przez `repository`).

**Contract**: tytuł `it('lets no account change or delete another account's subscription', …)`. Ten tytuł wpisujemy dosłownie w `twoAccountTest` obu tras.

**File**: `backend-subtracker/test/routes.e2e-spec.ts`

**Intent**: Dopisać `{ method: 'PUT', path: '/subscriptions/:id', access: 'session', twoAccountTest: '…' }` i to samo dla `DELETE`.

**File**: `backend-subtracker/test/subscriptions/access.e2e-spec.ts`

**Intent**: Dopisać obie trasy (z `UNKNOWN_ID`) do ręcznej listy przypadków 401.

### Success Criteria:

#### Automated Verification:

- Lint backendu przechodzi: `cd backend-subtracker && npm run lint`
- Build backendu przechodzi: `cd backend-subtracker && npm run build`
- Testy jednostkowe przechodzą: `cd backend-subtracker && npm test`
- Testy e2e API przechodzą, w tym `routes.e2e-spec.ts`: `cd backend-subtracker && npm run test:e2e`
- Sabotaż: po usunięciu filtra `userId` w `update` test dwóch kont jest czerwony; po cofnięciu zmiany znów zielony

#### Manual Verification:

- `migration:generate` na `subtracker-db` kończy się „No changes in database schema were found” (schemat bez zmian)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Edycja w panelu

### Overview

Użytkownik otwiera edycję z wiersza, poprawia dane w znanym formularzu i widzi zmiany na liście.

### Changes Required:

#### 1. Serwis i typy

**File**: `frontend-subtracker/src/app/subscriptions/subscriptions.service.ts`

**Intent**: Metoda `update(id, request)` wysyła `PUT ${apiUrl}/subscriptions/${id}`.

**Contract**: `update(id: string, request: CreateSubscriptionRequest): Observable<Subscription>`. Ciało jest tym samym typem co przy tworzeniu.

#### 2. Mapowanie API → formularz

**File**: `frontend-subtracker/src/app/subscriptions/subscription-request.ts`

**Intent**: Czysta funkcja odwrotna do `toCreateSubscriptionRequest`. Kwota w polskim zapisie (kropka → przecinek, `"43.00"` → `"43,00"`), daty przez `parseDateOnly`, `trialEndDate` `null` poza trialem, `categoryId` z `category.id`.

**Contract**: `toSubscriptionFormValue(subscription: Subscription): SubscriptionFormValue`. Złożenie z `toCreateSubscriptionRequest` daje ciało równe danym z API (kwota jako liczba).

**File**: `frontend-subtracker/src/app/subscriptions/subscription-request.spec.ts`

**Intent**: Tabela `it.each` z wyrocznią z kontraktu API:
- kwoty `"43.00"`, `"0.00"`, `"1234.50"`, `"99999.99"`;
- dzień daty zgodny z kalendarzem w obu strefach;
- trial z datą i bez triala;
- złożenie z `toCreateSubscriptionRequest` daje z powrotem dane z API.

#### 3. Formularz w trybie edycji

**File**: `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts`, `subscription-form.html`

**Intent**:
- Opcjonalne wejście `subscription`. Gdy jest ustawione, formularz wypełnia się w `ngOnInit`, a `submit` woła `update(subscription.id, …)` zamiast `create`. Przycisk ma tekst „Zapisz zmiany”, przy dodawaniu zostaje „Zapisz subskrypcję”.
- Odpowiedź 404 przy edycji emituje nowe wyjście `missing`, bo subskrypcja zniknęła, np. usunięta w innej karcie. 400 i pozostałe błędy działają jak dziś.

**Contract**: `readonly subscription = input<Subscription | null>(null)`; `readonly missing = output<void>()`; `saved` bez zmian.

**File**: `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.spec.ts`

**Intent**: Nowy `describe` dla edycji:
- pola pokazują dane subskrypcji (harnessy po etykiecie, kwota `43,00`, data `dd.mm.rrrr`), a trial ma widoczne pole końca triala;
- zapis bez zmian wysyła `PUT` z ciałem `toEqual` całemu kontraktowi;
- zmiana `trial` → `active` wysyła ciało bez `trialEndDate`;
- 404 emituje `missing`, a nie `saved`;
- przy edycji nie ma `POST` (`expectNone`).

#### 4. Akcje w tabeli

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.{ts,html,scss}`

**Intent**: Desktop dostaje kolumnę `actions` z przyciskami „Edytuj” i „Usuń”. Telefon dostaje te same przyciski w rozwiniętych szczegółach, pod listą `<dl>`. Tabela tylko emituje zdarzenia. Przyciski mają dostępną nazwę z nazwą subskrypcji (np. `aria-label="Edytuj Netflix"`), bo widoczny tekst w każdym wierszu jest ten sam.

**Contract**: `readonly edit = output<Subscription>()`; `readonly remove = output<Subscription>()`. „Usuń” podłącza się w fazie 3, a w tej fazie emituje zdarzenie bez odbiorcy.

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.spec.ts`

**Intent**: Klik „Edytuj Netflix” emituje `edit` z tą subskrypcją; na telefonie (`BreakpointObserver` dla `PHONE_MEDIA_QUERY`) przycisk jest dostępny po rozwinięciu wiersza.

#### 5. Strona: tryb panelu

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.{ts,html,scss}`, `frontend-subtracker/src/app/subscriptions/subscription-labels.ts`

**Intent**:
- `adding` zastępuje tryb panelu `closed | add | edit(subscription)`. Zachowanie dodawania się nie zmienia: przełącznik, auto-otwarcie pustej listy, `inert`, Escape, fokus na tytule i powrót fokusu do przycisku „Dodaj subskrypcję”.
- Panel ma neutralne id `subscription-panel`. Tytuł to „Nowa subskrypcja” albo „Edycja subskrypcji”, a `aria-expanded` przycisków dodawania jest prawdziwe tylko w trybie dodawania.
- Formularz powstaje od nowa przy zmianie celu (patrz Critical Implementation Details).
- Po `saved` w edycji:
  - formularz się odmontowuje;
  - pokazuje się komunikat z `updatedSubscriptionMessage(name)`;
  - lista odświeża się przez `load(true)`.
- Po `missing`:
  - panel się zamyka;
  - pokazuje się komunikat „Tej subskrypcji już nie ma na liście.”;
  - lista odświeża się przez `load(true)`.
- Sygnał `addedMessage` staje się ogólnym `statusMessage` w tym samym regionie `role="status"`.

**Contract**:
- `updatedSubscriptionMessage(name) => 'Zapisano zmiany w subskrypcji „${name}”.'`;
- `missingSubscriptionMessage = 'Tej subskrypcji już nie ma na liście.'`.

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.spec.ts`

**Intent**: Klik „Edytuj …” w liście z jedną subskrypcją otwiera panel „Edycja subskrypcji” z jej nazwą w polu. Zapis (`PUT` obsłużony przez `HttpTestingController`) pokazuje komunikat i wysyła ponownie `GET /subscriptions`.

### Success Criteria:

#### Automated Verification:

- Build frontendu przechodzi: `cd frontend-subtracker && npm run build`
- Testy frontendu przechodzą w obu strefach: `cd frontend-subtracker && npm run test:ci`
- Sabotaż: po zamianie `update` na `create` w `submit` test edycji formularza jest czerwony; po cofnięciu zmiany znów zielony

#### Manual Verification:

- Desktop ≥ 1200 px: „Edytuj” otwiera panel obok tabeli z danymi wiersza, zapis zmienia wiersz i pokazuje komunikat
- 840–1199 px: panel edycji zasłania tabelę, lista jest `inert`, Escape zamyka panel
- Telefon: „Edytuj” w rozwiniętych szczegółach otwiera pełny widok edycji, a zapis wraca do listy
- Szkic dodawania, potem „Edytuj” innego wiersza, potem „Dodaj subskrypcję”: formularz jest pusty, bez danych z edycji
- Trial z datą końca: pole daty jest widoczne i wypełnione, a zmiana statusu na „Aktywna” je ukrywa

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Usuwanie z dialogiem

### Overview

„Usuń” prosi o potwierdzenie w dialogu, a po potwierdzeniu subskrypcja znika z listy.

### Changes Required:

#### 1. Serwis

**File**: `frontend-subtracker/src/app/subscriptions/subscriptions.service.ts`

**Intent**: Metoda `delete(id)` wysyła `DELETE ${apiUrl}/subscriptions/${id}`.

**Contract**: `delete(id: string): Observable<void>`.

#### 2. Dialog potwierdzenia

**File**: `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/delete-subscription-dialog.{ts,html,scss}` (nowy)

**Intent**:
- Treść dialogu:
  - tytuł „Usunąć subskrypcję?”;
  - tekst z nazwą subskrypcji i informacją, że usunięcia nie da się cofnąć, a anulowanie usługi to zmiana statusu;
  - przyciski „Anuluj” i „Usuń” (`mat-flat-button`, bez czerwieni).
- „Usuń” sam wysyła `DELETE`. Podczas żądania przycisk jest wyłączony, a dialogu nie da się zamknąć.
- 204 zamyka dialog z wynikiem `'deleted'`.
- 404 zamyka dialog z wynikiem `'missing'`, bo subskrypcji już nie ma, czyli cel jest osiągnięty.
- Inny błąd zostawia dialog otwarty z alertem `role="alert"` „Nie udało się usunąć subskrypcji. Spróbuj ponownie.”.
- „Anuluj” i Escape zamykają dialog bez wyniku.

**Contract**:
- `MAT_DIALOG_DATA: { subscription: Subscription }`;
- wynik `afterClosed()`: `'deleted' | 'missing' | undefined`;
- dialog otwierany przez `MatDialog.open(DeleteSubscriptionDialog, { data, autoFocus: 'first-tabbable' })`, więc fokus trafia na „Anuluj”, pierwszy przycisk.

**File**: `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/delete-subscription-dialog.spec.ts` (nowy)

**Intent**:
- dialog pokazuje nazwę subskrypcji;
- „Usuń” wysyła `DELETE` na właściwy URL i zamyka z `'deleted'`;
- 404 zamyka z `'missing'`;
- 500 zostawia dialog z jednym `[role="alert"]` i bez zamknięcia;
- „Anuluj” nie wysyła żądania (`expectNone`).

Testy używają `MatDialogHarness` albo `MatDialogRef` z testową implementacją `close`, zgodnie z §6.2.

#### 3. Strona: obsługa „Usuń”

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.{ts,html}`, `frontend-subtracker/src/app/subscriptions/subscription-labels.ts`

**Intent**: Zdarzenie `remove` z tabeli otwiera dialog.
- Wynik `'deleted'`:
  - jeśli panel edytuje tę samą subskrypcję, panel się zamyka;
  - pokazuje się komunikat z `deletedSubscriptionMessage(name)`;
  - lista odświeża się przez `load(true)`.
- Wynik `'missing'`: komunikat jak przy `missing` w fazie 2 i odświeżenie listy.
- Brak wyniku: nic się nie zmienia, a fokus wraca na przycisk „Usuń” (zachowanie `MatDialog` z `restoreFocus`).

**Contract**: `deletedSubscriptionMessage(name) => 'Usunięto subskrypcję „${name}”.'`

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.spec.ts`

**Intent**: „Usuń …” → potwierdzenie w dialogu → `DELETE` 204 → komunikat i ponowny `GET /subscriptions`.

### Success Criteria:

#### Automated Verification:

- Build frontendu przechodzi: `cd frontend-subtracker && npm run build`
- Testy frontendu przechodzą w obu strefach: `cd frontend-subtracker && npm run test:ci`
- Sabotaż: po usunięciu wywołania `delete` w dialogu test „Usuń wysyła DELETE” jest czerwony; po cofnięciu zmiany znów zielony

#### Manual Verification:

- Desktop: „Usuń” otwiera dialog z nazwą, „Anuluj” zostawia wiersz, „Usuń” usuwa wiersz i pokazuje komunikat
- Telefon: dialog mieści się na ekranie, przyciski są dostępne kciukiem, a usunięcie z rozwiniętych szczegółów działa
- Klawiatura: Tab nie wychodzi z dialogu, Escape go zamyka, a fokus wraca na „Usuń”
- Usunięcie subskrypcji, która jest otwarta w panelu edycji, zamyka panel
- API wyłączone: dialog pokazuje alert i zostaje otwarty

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Test przeglądarkowy i cookbook

### Overview

Jeden test Playwright pilnuje całego przepływu z prawdziwym API i ciasteczkami. Cookbook w test-planie opisuje nowe wzorce.

### Changes Required:

#### 1. Test Playwright

**File**: `frontend-subtracker/e2e/browser/subscription-edit-delete.e2e-spec.ts` (nowy)

**Intent**: Projekt `chromium`, prefiks `e2e-browser-edit-delete-`, przebieg na desktopie:
1. Przez API zakłada dwie subskrypcje: kotwicę i cel.
2. Na `/subscriptions` „Edytuj <cel>”, zmiana nazwy i kwoty, „Zapisz zmiany”.
3. Po `page.reload()` region „Lista subskrypcji” pokazuje nową nazwę i kwotę.
4. „Usuń <nowa nazwa>”, potem „Usuń” w dialogu.
5. Po przeładowaniu kotwica jest widoczna, a cel ma `toHaveCount(0)`.

**Contract**: wzorce z §6.5: `createE2eAccounts`, `sessionFor`, seed przez fixture `request`, lokatory ról i etykiet, `removeTestData` w `beforeAll` i `afterAll`.

#### 2. Cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Uzupełnić §6 o to, czego nauczyła ta zmiana:
- §6.2: test dialogu Material jako referencja (`delete-subscription-dialog.spec.ts`), w tym jak sprawdzić wynik zamknięcia;
- §6.4: test dwóch kont dla `PUT`/`DELETE` jako referencja, oraz informacja, że jeden tytuł może obsłużyć kilka tras;
- §6.5: nowy prefiks na liście zajętych i nowy plik referencyjny.

**Contract**: tylko podsekcje §6.2, §6.4 i §6.5. Strategia §1–§5 bez zmian.

### Success Criteria:

#### Automated Verification:

- Build backendu dla API e2e: `cd backend-subtracker && npm run build`
- Build e2e frontendu: `cd frontend-subtracker && npm run build:e2e`
- Testy przeglądarkowe przechodzą: `cd frontend-subtracker && npm run e2e`
- Sabotaż: po zamianie `load(true)` po usunięciu na brak odświeżenia, z ponownym `build:e2e`, test jest czerwony; po cofnięciu zmiany i ponownym buildzie znów zielony

#### Manual Verification:

- Wpisy §6.2, §6.4 i §6.5 w `test-plan.md` wskazują istniejące pliki i polecenia

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `toSubscriptionFormValue`: kwoty, daty w dwóch strefach, trial i nie-trial, złożenie z `toCreateSubscriptionRequest`.
- Komponenty:
  - formularz w trybie edycji: wypełnienie, ciało `PUT`, zmiana statusu, 404;
  - tabela: akcje emitują zdarzenia;
  - dialog: wyniki `'deleted'`, `'missing'`, błąd, „Anuluj”;
  - strona: przepływ edycji i usunięcia na granicy HTTP.

### Integration Tests:

- API e2e:
  - `PUT` i `DELETE` dla właściciela;
  - 400 dla id, które nie jest UUID, i dla złego ciała;
  - 404 dla nieznanego id, także przy powtórnym `DELETE`;
  - test dwóch kont dla obu tras, który jest bramką ryzyka #1;
  - 401 bez sesji;
  - rejestr tras.
- Playwright: edycja i usunięcie na desktopie z kotwicą.

### Manual Testing Steps:

1. Dodaj subskrypcję w trialu, otwórz „Edytuj”, zmień status na „Aktywna” i zapisz. Na liście nie ma daty końca triala.
2. W dwóch kartach usuń subskrypcję w pierwszej, a w drugiej zapisz jej edycję. Pojawia się komunikat „Tej subskrypcji już nie ma na liście.” i lista się odświeża.
3. Na telefonie rozwiń wiersz, użyj „Edytuj”, a potem „Usuń”.

## Performance Considerations

Nie dotyczy: operacje na jednym wierszu po kluczu głównym i `user_id` (indeks istnieje), a lista odświeża się jednym `GET`.

## Migration Notes

Brak zmian schematu. Encje się nie zmieniają, więc reguła „migracja na koniec funkcji” (`lessons.md`) sprowadza się do sprawdzenia w fazie 1, że `migration:generate` nie znajduje zmian.

## References

- Research: `context/changes/edit-and-delete-subscription/research.md`
- Roadmap: `context/foundation/roadmap.md` (S-03)
- PRD: `context/foundation/prd.md:70-73` (FR-005, FR-006)
- Test-plan: `context/foundation/test-plan.md` §2 ryzyko #1, #3 i #7; §6.2, §6.4 i §6.5
- Wzorzec tworzenia: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:56-89`, `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:242-265`
- Decyzje UI: `context/archive/2026-11-10-ui-foundation/change.md:20`, `context/archive/2026-11-11-first-subscription-in-list/plan.md:32,336`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API edycji i usuwania

#### Automated

- [x] 1.1 Lint backendu przechodzi: `cd backend-subtracker && npm run lint` — f11c6df
- [x] 1.2 Build backendu przechodzi: `cd backend-subtracker && npm run build` — f11c6df
- [x] 1.3 Testy jednostkowe przechodzą: `cd backend-subtracker && npm test` — f11c6df
- [x] 1.4 Testy e2e API przechodzą, w tym `routes.e2e-spec.ts`: `cd backend-subtracker && npm run test:e2e` — f11c6df
- [x] 1.5 Sabotaż: po usunięciu filtra `userId` w `update` test dwóch kont jest czerwony; po cofnięciu zmiany znów zielony — f11c6df

#### Manual

- [x] 1.6 `migration:generate` na `subtracker-db` kończy się „No changes in database schema were found” (schemat bez zmian) — f11c6df

### Phase 2: Edycja w panelu

#### Automated

- [x] 2.1 Build frontendu przechodzi: `cd frontend-subtracker && npm run build` — b7d8154
- [x] 2.2 Testy frontendu przechodzą w obu strefach: `cd frontend-subtracker && npm run test:ci` — b7d8154
- [x] 2.3 Sabotaż: po zamianie `update` na `create` w `submit` test edycji formularza jest czerwony; po cofnięciu zmiany znów zielony — b7d8154

#### Manual

- [x] 2.4 Desktop ≥ 1200 px: „Edytuj” otwiera panel obok tabeli z danymi wiersza, zapis zmienia wiersz i pokazuje komunikat — b7d8154
- [x] 2.5 840–1199 px: panel edycji zasłania tabelę, lista jest `inert`, Escape zamyka panel — b7d8154
- [x] 2.6 Telefon: „Edytuj” w rozwiniętych szczegółach otwiera pełny widok edycji, a zapis wraca do listy — b7d8154
- [x] 2.7 Szkic dodawania, potem „Edytuj” innego wiersza, potem „Dodaj subskrypcję”: formularz jest pusty, bez danych z edycji — b7d8154
- [x] 2.8 Trial z datą końca: pole daty jest widoczne i wypełnione, a zmiana statusu na „Aktywna” je ukrywa — b7d8154

### Phase 3: Usuwanie z dialogiem

#### Automated

- [x] 3.1 Build frontendu przechodzi: `cd frontend-subtracker && npm run build`
- [x] 3.2 Testy frontendu przechodzą w obu strefach: `cd frontend-subtracker && npm run test:ci`
- [x] 3.3 Sabotaż: po usunięciu wywołania `delete` w dialogu test „Usuń wysyła DELETE” jest czerwony; po cofnięciu zmiany znów zielony

#### Manual

- [x] 3.4 Desktop: „Usuń” otwiera dialog z nazwą, „Anuluj” zostawia wiersz, „Usuń” usuwa wiersz i pokazuje komunikat
- [x] 3.5 Telefon: dialog mieści się na ekranie, przyciski są dostępne kciukiem, a usunięcie z rozwiniętych szczegółów działa
- [x] 3.6 Klawiatura: Tab nie wychodzi z dialogu, Escape go zamyka, a fokus wraca na „Usuń”
- [x] 3.7 Usunięcie subskrypcji, która jest otwarta w panelu edycji, zamyka panel
- [x] 3.8 API wyłączone: dialog pokazuje alert i zostaje otwarty

### Phase 4: Test przeglądarkowy i cookbook

#### Automated

- [ ] 4.1 Build backendu dla API e2e: `cd backend-subtracker && npm run build`
- [ ] 4.2 Build e2e frontendu: `cd frontend-subtracker && npm run build:e2e`
- [ ] 4.3 Testy przeglądarkowe przechodzą: `cd frontend-subtracker && npm run e2e`
- [ ] 4.4 Sabotaż: po zamianie `load(true)` po usunięciu na brak odświeżenia, z ponownym `build:e2e`, test jest czerwony; po cofnięciu zmiany i ponownym buildzie znów zielony

#### Manual

- [ ] 4.5 Wpisy §6.2, §6.4 i §6.5 w `test-plan.md` wskazują istniejące pliki i polecenia
