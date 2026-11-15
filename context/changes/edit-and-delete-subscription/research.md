---
date: 2026-11-15T09:19:15+01:00
researcher: Claude (Opus 5.5) dla Jakub Pietrzykowski
git_commit: ff89d2cbe78352437dcc24a6dd5d5ea6ff6eadfe
branch: change/edit-and-delete-subscription
repository: 10xProject (SubTracker)
topic: "S-03: na czym opiera się edycja i twarde usuwanie subskrypcji (FR-005, FR-006)"
tags: [research, backend-subtracker, frontend-subtracker, subscriptions, account-isolation, test-plan]
status: complete
last_updated: 2026-11-15
last_updated_by: Claude (Opus 5.5)
---

# Research: edycja i usuwanie subskrypcji (S-03)

**Date**: 2026-11-15T09:19:15+01:00
**Git Commit**: ff89d2cbe78352437dcc24a6dd5d5ea6ff6eadfe
**Branch**: change/edit-and-delete-subscription
**Repository**: 10xProject (SubTracker)

## Research Question

Co w obecnym kodzie, dokumentach i testach wspiera lub ogranicza slice S-03 „użytkownik poprawia lub usuwa błędnie dodaną subskrypcję” (`context/foundation/roadmap.md:154-164`; PRD FR-005 edycja z wymogiem ponownego przeliczenia, FR-006 twarde usunięcie odrębne od anulowania z FR-013 — `context/foundation/prd.md:70-73`)? Jakie kontrakty S-03 dotyka i które decyzje pozostają otwarte dla `/10x-plan`?

## Summary

- **Backend nie ma dziś żadnej trasy po id.** `SubscriptionsController` udostępnia tylko `GET` i `POST /subscriptions` (`backend-subtracker/src/subscriptions/controllers/subscriptions.controller.ts:16-34`). W `backend-subtracker/src` nie ma `@Param`, `ParseUUIDPipe`, `NotFoundException` ani DTO aktualizacji (przeszukany cały `src`). Wszystko to jest nową pracą.
- **Ochrona CSRF i CORS już obejmują PATCH/PUT/DELETE**: ochrona Nesta zwalnia tylko `GET`, `HEAD`, `OPTIONS` (`node_modules/@nestjs/core/security/cross-origin-protection.js:6,35`), a `enableCors` bez opcji `methods` (`src/config/cors.ts:4`) używa domyślnej listy pakietu `cors` `GET,HEAD,PUT,PATCH,POST,DELETE` (`node_modules/cors/lib/index.js:10`). Nowe trasy nie wymagają nic dodatkowego (zgodnie z `context/foundation/backend-patterns.md:57`).
- **Twarde usunięcie dotyczy jednego wiersza**: żadna tabela nie ma klucza obcego do `subscription.id` (encja i migracja `1794406389791-SubscriptionsSchema.ts`); FK `user_id` ma `CASCADE`, FK `category_id` ma `NO ACTION` (migracja :26, :29). Brak kolumn `updatedAt`/`version`.
- **Reguły krzyżowe DTO czytają `status` z tego samego obiektu** (`create-subscription.dto.ts:20-21`), więc częściowy PATCH bez `status` byłby walidowany jak subskrypcja nie-trialowa. Edycja wymaga albo pełnego ciała (zamiana całości), albo scalenia z zapisanym wierszem przed walidacją.
- **Izolacja kont ma gotową bramkę**: `test/routes.e2e-spec.ts:162-177` przerywa CI, jeśli trasa z `:` nie wskazuje testu dwóch kont, którego tytuł istnieje w plikach e2e; test-plan §6.4 wymaga, by konto B dostawało 404 (lub 403, jeśli tak mówi kontrakt) na odczyt/zmianę/usunięcie zasobu A, a zasób A pozostał nienaruszony (`context/foundation/test-plan.md:147`). Ryzyko #1 (IDOR) w test-planie wprost wymienia S-03 (`test-plan.md:42`).
- **Frontend: formularz jest osobnym komponentem, ale tylko do tworzenia** — jedyne wejście/wyjście to `stickyActions` i `saved` (`frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:104-105`), `submit` woła `create()` na sztywno, tekst przycisku i tytuł panelu „Nowa subskrypcja” są stałe. Tabela nie ma akcji w wierszu; w aplikacji nie ma `MatDialog` ani `MatSnackBar` (grep `src` i `e2e`). Serwis API nie ma metod update/delete.
- **Wymóg przeliczenia z FR-005** nie ma dziś czego przeliczać: sumy, duplikaty i budżet powstają w S-04/S-07/S-08, które według roadmapy muszą liczyć po edycji (`roadmap.md:163`). Dla S-03 wystarcza, że lista po edycji/usunięciu odświeża się z API.

## Detailed Findings

### Backend — model danych

- `Subscription` (`backend-subtracker/src/subscriptions/entities/subscription.entity.ts`): `id` uuid (:24); `userId` uuid, not null, `@Index` (:27-29), relacja do `User` z `onDelete: 'CASCADE'` (:32-34); `categoryId` uuid, not null, `@Index` (:38-40), relacja do `Category` bez `onDelete` → `NO ACTION` (:42-44); `name` varchar(100) (:46); `amount` numeric(10,2) jako string (:50-51); `billingCycle` varchar(16) (:53); `paymentMethod` varchar(32) (:56); `status` varchar(32) (:59); `trialEndDate` date nullable (:62-63); `nextBillingDate` date (:65); `createdAt` timestamptz (:68).
- Statusy: `trial`, `active`, `cancelled_pending`, `cancelled` (`src/subscriptions/subscription.types.ts:2-7`). W kodzie nie ma reguł przejść; jedyna logika zależna od statusu to reguły dat w DTO i grupowanie w `subscription-order.ts:5-10`.
- Wniosek: S-03 nie zmienia schematu, o ile plan nie doda np. `updatedAt`. Zmiana encji uruchamia regułę migracji z `lessons.md`.

### Backend — walidacja i serwis

- `CreateSubscriptionDto` (`src/subscriptions/dtos/create-subscription.dto.ts`): `name` `@TrimmedString(100)` (:61); `categoryId` `@IsUUID` (:64); `amount` liczba JSON, maks. 2 miejsca, 0–99 999,99 (:67-70); `billingCycle`, `paymentMethod`, `status` `@IsEnum` (:72-79); `trialEndDate` — `TrialEndDateRule` (:23-35): wymagana data dla `trial`, dla innych statusów `undefined`/`null`; `nextBillingDate` `@IsDateOnly` + `NotBeforeTrialEnd` (:37-57, :84-85). Daty z przeszłości dozwolone (:59).
- Globalny `ValidationPipe` jako `APP_PIPE` z `whitelist`, `forbidNonWhitelisted`, `transform` (`src/app.module.ts:38-45`) — nieznane pole w ciele daje 400 (w tym `userId`).
- `@nestjs/mapped-types` nie ma w `package.json` (wg raportu backendu), więc `PartialType` nie jest dostępne bez nowej zależności.
- `SubscriptionsService` (`src/subscriptions/services/subscriptions.service.ts`): `list` filtruje `subscription.userId = :userId` (:48-51); `create` bierze `userId` z sesji (:74), kategorię przez `CategoriesService.findUsable(userId, categoryId)` (`categories.service.ts:80-87`), brak → `BadRequestException` 400 (:63-68); kwota `toFixed(2)` (:77); `trialEndDate` zerowane, gdy status ≠ `trial` (:81-84). Odpowiedź z `toSubscriptionResponse` (:17-33), funkcja nieeksportowana.
- Zmiana kategorii przy edycji musi przejść przez `findUsable`, bo baza nie wymusza, że subskrypcja i kategoria mają tego samego właściciela (`context/archive/2026-11-13-backend-e2e-account-isolation/research.md:51`).
- `isUniqueViolation` (`src/shared/database/unique-violation.ts:7-16`) dotyczy tylko kategorii; subskrypcje nie mają ograniczenia unikalności.

### Backend — dostęp, CSRF, CORS

- `SessionAuthGuard` globalny (`src/auth/auth.module.ts:20`), `@CurrentUser()` rzuca 401 bez użytkownika (`src/shared/decorators/current-user.decorator.ts:9-17`).
- Izolacja kont jest zadaniem serwisu: zapytania filtrują `where: { id, user: { id: currentUser.id } }` (`context/foundation/backend-patterns.md:22`).
- CSRF: `app.enableCsrfProtection({ trustedOrigins })` (`src/config/http-security.ts:14`), metody inne niż GET/HEAD/OPTIONS sprawdzane jak POST; odrzucenie = 403. Frontend nie wysyła żadnego tokenu (`frontend-subtracker/src/app/auth/credentials.interceptor.ts:4-10` ustawia tylko `withCredentials`).

### Backend — testy

- Unit: `create-subscription.dto.spec.ts` (`plainToInstance` + `validate` z `whitelist`/`forbidNonWhitelisted`, :24-35), `subscription-order.spec.ts`, `categories.service.spec.ts`. Brak `subscriptions.service.spec.ts`.
- E2E w `backend-subtracker/test/subscriptions/`: `subscriptions-e2e.ts` (helpery `subscriptionBody`, `subscriptionRequests` — bez patch/delete), `subscriptions.e2e-spec.ts` (tworzenie, lista, 400-ki `it.each` :78-104, kaskada :171), `access.e2e-spec.ts` (401 bez sesji, ręczna lista tras :18-54), `account-isolation.e2e-spec.ts` (wzorzec `twoAccounts()`; komentarz :6-7: nowa trasa po id dodaje tu test i wpis w `routes.e2e-spec.ts`).
- `test/routes.e2e-spec.ts`: `EXPECTED_ROUTES` (:36-49) musi wymienić każdą trasę; :162-177 wymaga `twoAccountTest` dla tras z `:`; :179-199 woła każdą trasę sesyjną z `UNKNOWN_ID` bez ciasteczka i oczekuje 401.
- Helper `test/support/e2e-app.ts`: `createE2eApp({addressPrefix})`, `twoAccounts`, `signIn`, `http`, `repository`; sprzątanie usuwa `Subscription` przed `Category` (:135-147).

### Frontend — strona `/subscriptions`

- Pliki: `src/app/pages/subscriptions/subscriptions.{ts,html,scss}`, tabela `pages/subscriptions/subscription-table/`, formularz `src/app/subscriptions/subscription-form/`.
- Stan: `ListState` loading|error|ready (`subscriptions.ts:30-31,60`); dodawanie to sygnały `adding` (:62), `formMounted` (:65), `addedMessage` (:66), `refreshFailed` (:68); `listCovered` → `inert` na liście (:79, html:5); `toggleAdding`/`close`/`open`/`autoOpen` (:137,:159,:176,:195); Escape `onPanelEscape` (:149); fokus przez `afterNextRender` (:81-101, :206-212).
- Panel: `<section id="new-subscription-panel">` z tytułem „Nowa subskrypcja” i `<app-subscription-form [stickyActions]="isPhone()" (saved)="onSaved($event)">` (`subscriptions.html:70-95`).
- Po zapisie `onSaved` (:166-174): odmontowanie formularza, komunikat z `subscription-labels.ts:97`, cichy `load(true)`; nowszy `load` anuluje starszy (:111-135); nieudany cichy reload → alert `refreshFailed` z ponowieniem (html:30-35).
- Tabela: jeden `mat-table` dla obu układów (`subscription-table.ts:22-46`); na telefonie kolumna `summary` jako `<button>` przełączający `expandedId` (:47, :64) i wiersz `details` (html:91-170). Brak akcji w wierszu; na telefonie przycisk wiersza jest zajęty przez rozwinięcie, więc akcje muszą trafić np. do rozwiniętych szczegółów (html:136).

### Frontend — formularz, serwis, helpery

- Formularz (`subscription-form.ts`): `NonNullableFormBuilder` (:120-134); `trialEndDate` włączane tylko dla `trial` przez `valueChanges` (:115, :163-169); `notBeforeDate` (:130-133); własna kategoria inline (:135, :197, 409 → `conflict` :233). `submit` (:242-265): `toCreateSubscriptionRequest` (`subscription-request.ts:24`), `create()`, 400 → `invalid`, reszta → `unavailable` (html:151-160).
- Serwis `subscriptions.service.ts:14-35`: `list`, `create`, `categories`, `createCategory` — brak update/delete.
- Typy `subscription.types.ts`: `Subscription` (:24-35, `amount: string`, daty `YYYY-MM-DD`, `category` jako obiekt); `CreateSubscriptionRequest` (:39-48, `amount: number`, `categoryId`).
- Wypełnianie formularza z API: daty przez `parseDateOnly` (`src/app/shared/date-only.ts:9`), nigdy `new Date(str)`; kwota `"43.00"` przechodzi `parseDecimal` (`shared/decimal.ts:7`), ale polskie wyświetlenie z przecinkiem wymaga nowej zamiany — dziś nie ma helpera kierunku API → pole. `SubscriptionFormValue` (`subscription-request.ts:11-20`) to docelowy kształt mapowania odwrotnego.
- Trasy: `subscriptions` z `authGuard` (`app.routes.ts:30-34`), `RenderMode.Client` (`app.routes.server.ts:27-30`). Brak tras podrzędnych; lekcja „trasy po angielsku” dotyczy ewentualnego nowego parametru URL.

### Frontend — testy

- `subscriptions.spec.ts` i `subscription-table.spec.ts` mają tylko „should create”. `subscription-form.spec.ts` (417 linii) to wzorzec testu komponentu z harnessami Material (helpery :105-159), sprawdza ciało POST (:356+).
- Playwright: `e2e/browser/subscriptions-flow.e2e-spec.ts` (jeden test :73, seed przez API :40-66, lokatory ról/etykiet, region „Lista subskrypcji” :69-71); sprzątanie `e2e/support/accounts.ts:157-170`.

## Code References

- `backend-subtracker/src/subscriptions/controllers/subscriptions.controller.ts:16-34` — jedyne trasy subskrypcji (GET, POST)
- `backend-subtracker/src/subscriptions/dtos/create-subscription.dto.ts:20-57` — reguły krzyżowe zależne od `status`
- `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:17-33,48-51,63-84` — mapper odpowiedzi, filtr właściciela, sprawdzenie kategorii, zerowanie `trialEndDate`
- `backend-subtracker/src/subscriptions/services/categories.service.ts:80-87` — `findUsable`
- `backend-subtracker/src/config/http-security.ts:14`, `src/config/cors.ts:4` — CSRF i CORS
- `backend-subtracker/src/app.module.ts:38-45` — globalny `ValidationPipe`
- `backend-subtracker/test/routes.e2e-spec.ts:36-49,162-199` — rejestr tras i bramka testu dwóch kont
- `backend-subtracker/test/subscriptions/account-isolation.e2e-spec.ts:6-7` — miejsce na testy dwóch kont
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:104-105,242-265` — wejścia formularza i `submit`
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:60-212`, `subscriptions.html:70-95` — stan dodawania i panel
- `frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.html:91-170` — wiersz szczegółów na telefonie
- `frontend-subtracker/src/app/subscriptions/subscriptions.service.ts:14-35` — serwis API

## Architecture Insights

- Własność zasobu sprawdza serwis, nie guard; precedens „cudza kategoria = ten sam 400 co nieistniejąca” (`backend-patterns.md:99`) oznacza: nie ujawniać istnienia cudzego zasobu. Dla trasy po id analogią jest jednolite 404 dla nieistniejącego i cudzego id (wniosek, nie zapisana reguła).
- Kod ogólny (np. walidator/pipe UUID, helper 23503) trafia do `src/shared/` z testem obok (`lessons.md`, „Kod ogólny w `shared/`”).
- Odpowiedzi: status w kodzie HTTP, `no-store` dla danych użytkownika, jawny `@HttpCode` (`backend-patterns.md:89,105`).
- Frontend nie obsługuje wygaśnięcia sesji na stronie — robi to `session-expired.interceptor.ts`.

## Historical Context (from prior changes)

- `context/archive/2026-11-11-first-subscription-in-list/plan.md:32` (i `plan-brief.md:42`) — edycja i usuwanie odłożone do S-03; link „Edytuj” w rozwiniętym wierszu miał przyjść z S-03. Werdykt: nadal aktualne, wiersz szczegółów istnieje.
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:92` — przy tworzeniu dozwolone wszystkie 4 statusy, domyślnie `active`; reguły dat jak w DTO. Werdykt: zgodne z kodem (`create-subscription.dto.ts:23-57`).
- `context/archive/2026-11-11-first-subscription-in-list/research.md:48` — usuwanie twarde, bez kolumny „deleted”. Werdykt: zgodne z PRD FR-006.
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:336,338` — jeden `mat-table` z rozwijanymi wierszami na telefonie; obsługa przycisku „wstecz” Androida odłożona (planowana jako parametr URL). Werdykt: tabela zgodna z kodem; „wstecz” nadal niezrobione (brak tras podrzędnych w `app.routes.ts:30-34`).
- `context/archive/2026-11-10-ui-foundation/change.md:20` — rozwijany wiersz pokazuje ukryte dane i link „Edytuj”, oglądanie nie wymaga trybu edycji. Brak jakichkolwiek ustaleń o dialogu potwierdzenia ani przycisku destrukcyjnym; kolory: czerwony tylko dla błędów (`first-subscription-in-list/plan.md:336`).
- `context/archive/2026-11-13-backend-e2e-account-isolation/plan.md:245-247` — bramka „trasa z `:` ma test dwóch kont” nabiera znaczenia od S-03.
- `context/archive/2026-11-11-first-subscription-in-list/reviews/impl-review-phase-1.md:75-83` — usuwanie kategorii trafi w FK `NO ACTION` (23503 → 500). S-03 nie usuwa kategorii, więc nie dotyczy, chyba że plan rozszerzy zakres.

## Related Research

- `context/archive/2026-11-11-first-subscription-in-list/research.md`
- `context/archive/2026-11-13-backend-e2e-account-isolation/research.md`

## Open Questions

Decyzje dla `/10x-plan` (żadna nie jest zapisana w repo):

1. **PATCH czy PUT** dla `/subscriptions/:id` — reguły krzyżowe DTO zależą od `status`, więc PATCH częściowy wymaga scalenia z wierszem przed walidacją; pełne ciało pozwala użyć ponownie `CreateSubscriptionDto` i formularza bez zmian kontraktu.
2. **Kod odpowiedzi dla cudzego/nieistniejącego id** (404 jednolite vs 403) i dla niepoprawnego UUID (400 vs 404). Test-plan dopuszcza oba (`test-plan.md:147`).
3. **Odpowiedź DELETE** (204 bez treści?) i czy powtórne DELETE daje 404.
4. **Zmiana statusu przy edycji** — dowolna (także powrót do `trial`), czy ograniczona; jak to się ma do przyszłej maszyny stanów S-05 (FR-013). Przy zmianie z `trial` na inny serwis zeruje dziś `trialEndDate` tylko przy tworzeniu.
5. **UI**: gdzie są akcje (rozwinięty wiersz na telefonie, kolumna lub menu na desktopie), czy edycja używa tego samego panelu co dodawanie (tytuł, id sekcji, `formMounted`), forma potwierdzenia usunięcia (dialog Material — pierwsze użycie `MatDialog` — czy potwierdzenie inline), komunikat po zapisie/usunięciu, i czy edycja dostaje parametr URL (wtedy także przycisk „wstecz” i reguła tras po angielsku).
6. **Wymóg przeliczenia FR-005** — w S-03 wystarcza odświeżenie listy; plan powinien to zapisać jawnie, by S-04/S-07/S-08 wiedziały, że przeliczają przy każdym odczycie.
