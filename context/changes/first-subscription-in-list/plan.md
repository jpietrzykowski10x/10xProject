# Dodanie pierwszej subskrypcji i lista subskrypcji (S-02) — plan implementacji

## Overview

Zalogowany użytkownik dodaje subskrypcję ze wszystkimi polami z FR-004 (kategoria domyślna albo własna) i od razu widzi ją na liście swoich subskrypcji. Backend dostaje dwie encje z izolacją kont i API, frontend — listę i formularz dodawania według makiet F2. To gwiazda przewodnia z roadmapy: od wejścia na stronę do pierwszej subskrypcji na liście w mniej niż 3 minuty.

## Current State Analysis

Pełne badanie: `context/changes/first-subscription-in-list/research.md`.

- API ma gotowe bezpieczeństwo domyślne: globalny `SessionAuthGuard` + `RolesGuard` (`backend-subtracker/src/auth/auth.module.ts:19-21`), `@CurrentUser()` (`src/shared/decorators/current-user.decorator.ts:9-17`), globalny `ValidationPipe` z `whitelist`/`forbidNonWhitelisted`/`transform` (`src/app.module.ts:36-43`), filtr wyjątków bez logu 4xx i ochronę CSRF. Nie ma żadnej encji domenowej, kolumny pieniężnej, kolumny `date` ani zamkniętej listy domeny.
- Wzorce do powtórzenia: FK do `user` z indeksem i `Relation<User>` (`src/auth/entities/session.entity.ts:21-27`), zamknięte listy jako `varchar` + enum TS (`src/mail/entities/mail.entity.ts:18-25`), stałe id danych startowych w jednym module (`src/shared/types/role-code.ts`), migracja danych z wartościami wpisanymi wprost (`src/database/migrations/1793732271790-SeedRoles.ts`) i seeder bazy dev (`src/users/services/roles-seeder.ts`).
- Frontend: `/subscriptions` z `authGuard`, `RenderMode.Client` (`frontend-subtracker/src/app/app.routes.ts:30-34`, `app.routes.server.ts:28-31`), strona z pustym stanem (`src/app/pages/subscriptions/`), wzorzec formularzy (`src/app/pages/register/`), wzorzec serwisu HTTP z ciasteczkiem przez `credentialsInterceptor` (`src/app/auth/auth.service.ts`, `credentials.interceptor.ts`), motyw z `select`, `table`, `button-toggle`, `sidenav` (`src/styles/_theme.scss`). Brak locale `pl`, adaptera dat i miejsca na panel w `AppShell` (jeden `<ng-content>`).

## Desired End State

- `GET /categories` zwraca 9 kategorii domyślnych i własne kategorie użytkownika; `POST /categories` dodaje własną (unikalność bez wielkości liter względem własnych i domyślnych).
- `POST /subscriptions` zapisuje subskrypcję zalogowanego użytkownika; `GET /subscriptions` zwraca wyłącznie jego subskrypcje w kolejności: grupa statusu (Aktywna i Trial → W trakcie anulowania → Anulowana), w grupie rosnąco po najbliższej dacie, przy remisie po nazwie.
- Usunięcie użytkownika usuwa jego subskrypcje i własne kategorie (kaskada).
- `/subscriptions` na desktopie: tabela z 5 kolumnami i panel „Nowa subskrypcja” (zamknięty domyślnie, otwarty przy pustej liście, nad tabelą poniżej ~1200 px). Na telefonie (< 840 px): lista z rozwijanymi wierszami i przycisk „Dodaj subskrypcję” prowadzący do `/subscriptions/new`.
- Kwoty w formacie polskim („1 233,87 zł”), daty „15.11.2026”.

### Key Discoveries:

- `numeric` z Postgresa wraca z node-pg jako string, `date` jako `'YYYY-MM-DD'` — w repo nie ma transformerów (research, „Backend: co S-02 wprowadza po raz pierwszy”).
- FK w istniejących migracjach są `ON DELETE NO ACTION` (`src/database/migrations/1793732263880-AuthAndMailSchema.ts`); S-02 jako pierwsze wprowadza kaskadę.
- Makieta F2-Lista nie ma pola końca okresu próbnego, choć FR-004 go wymaga; zgodnie z decyzją pole pojawia się tylko przy statusie Trial.
- `@angular/common/locales/pl` jest w paczce, ale niezarejestrowane; natywny adapter dat Materiala nie parsuje `dd.mm.rrrr`.

## What We're NOT Doing

- Edycji i usuwania subskrypcji (S-03); link „Edytuj” w rozwiniętym wierszu pojawi się w S-03.
- Sum, przeliczenia rocznej kwoty na miesięczną, sum w kolumnie i na telefonie (S-04).
- Automatycznych przejść statusów i przypomnień (S-05, S-06), duplikatów i limitów (S-07, S-08).
- Sortowania i filtrowania przez użytkownika (FR-016) — kolejność jest jedną wartością enum w serwisie, gotową do rozbudowy.
- Edycji, zmiany nazwy, ukrywania i usuwania kategorii (domyślnych i własnych).
- Funkcji „Usuń konto” w UI i API — dostaje nowy slice w roadmapie (faza 4); w S-02 tylko kaskada w danych.
- Waluty innej niż PLN.
- Limitów liczby własnych kategorii i subskrypcji na konto oraz paginacji listy — przy skali MVP (kilkanaście–kilkadziesiąt pozycji) zbędne.

## Implementation Approach

Najpierw backend z pełnymi testami e2e (izolacja kont, walidacja, kolejność), bo frontend zależy od jego kontraktu. Potem lista (czyta dane), potem formularz (zapisuje). Formularz i lista dzielą `SubscriptionsService` i słowniki etykiet. Wdrożenie razem dla obu aplikacji po fazie 3.

## Critical Implementation Details

- **Unikalność kategorii**: unikalny indeks wyrażeniowy `(COALESCE(user_id, '00000000-0000-0000-0000-000000000000'), lower(name))` napisany ręcznie w migracji; w encji oznaczony `@Index('UQ_category_owner_name', { synchronize: false })`, żeby `migration:generate` go nie usuwał i nie generował ponownie. `synchronize` też go wtedy nie tworzy, więc seeder bazy dev (ten sam, który wstawia kategorie domyślne) wykonuje `CREATE UNIQUE INDEX IF NOT EXISTS` z tą samą definicją; SQL indeksu jest jedną wspólną stałą dla migracji i seedera. Serwis sprawdza konflikt przed zapisem i zwraca 409, a naruszenie indeksu przy wyścigu (`23505`) też mapuje na 409.
- **Dane startowe**: id 9 kategorii domyślnych w jednym module stałych (wzór `role-code.ts`), migracja `SeedDefaultCategories` z wartościami wpisanymi wprost, seeder bazy dev działający tylko przy `synchronize` (wzór `RolesSeeder`). Zgodnie z regułą z `lessons.md`: migracje schematu i danych osobno, generowane względem `subtracker-db` na końcu fazy 1.
- **Daty bez strefy**: frontend buduje `YYYY-MM-DD` z lokalnych części daty, nie z `toISOString()` (przesunięcie o dzień w strefie UTC+1).

## Phase 1: Backend — kategorie, subskrypcje i API

### Overview

Model danych, migracje, dane startowe i cztery endpointy z izolacją kont i testami.

### Changes Required:

#### 1. Słowniki i stałe

**File**: `backend-subtracker/src/subscriptions/subscription.types.ts` (nowy), `backend-subtracker/src/subscriptions/default-categories.ts` (nowy)

**Intent**: Jedno źródło kodów zamkniętych list i kategorii domyślnych.

**Contract**:
- `SubscriptionStatus`: `trial`, `active`, `cancelled_pending`, `cancelled`.
- `BillingCycle`: `monthly`, `yearly`.
- `PaymentMethod`: `credit_card`, `debit_card`, `blik`, `bank_transfer`, `e_wallet`, `other` (FR-004: karta kredytowa, karta debetowa, BLIK, przelew/zlecenie stałe, portfel elektroniczny, inne).
- `SubscriptionSort`: na razie jedna wartość `status_then_date`.
- `DEFAULT_CATEGORIES`: 9 pozycji `{ id: <stały uuid>, name }` w kolejności: Streaming, Gry, Oprogramowanie i narzędzia, Chmura i dane, Edukacja, Zdrowie i sport, Prasa i książki, Dom i usługi, Inne.
- Limity jako eksportowane stałe: `SUBSCRIPTION_NAME_MAX_LENGTH = 100`, `CATEGORY_NAME_MAX_LENGTH = 50`, `AMOUNT_MAX = 99999.99`.

#### 2. Encje

**File**: `backend-subtracker/src/subscriptions/entities/category.entity.ts`, `subscription.entity.ts` (nowe)

**Intent**: Tabele `category` i `subscription` według wzorców repo.

**Contract**:
- `category`: `id` uuid, `user_id` uuid NULL (NULL = domyślna) z indeksem i FK `ON DELETE CASCADE`, `name` varchar(50), `created_at` timestamptz; unikalny indeks wyrażeniowy z „Critical Implementation Details”.
- `subscription`: `id` uuid, `user_id` uuid NOT NULL z indeksem i FK `ON DELETE CASCADE`, `category_id` uuid NOT NULL z indeksem i FK do `category` (`NO ACTION`), `name` varchar(100), `amount` numeric(10,2) (0–99 999,99), `billing_cycle` varchar(16), `payment_method` varchar(32), `status` varchar(32), `trial_end_date` date NULL, `next_billing_date` date NOT NULL, `created_at` timestamptz. Typy w TS: `amount: string`, daty `string` (`YYYY-MM-DD`), statusy i listy jako enumy. Relacje `Relation<User>`, `Relation<Category>`, cele jako funkcje.

#### 3. Moduł, serwisy, kontrolery, DTO

**File**: `backend-subtracker/src/subscriptions/` (`subscriptions.module.ts`, `controllers/`, `services/`, `dtos/`), `src/app.module.ts`

**Intent**: API dla zalogowanego użytkownika; wszystko filtrowane po `currentUser.id`, `userId` nigdy z body.

**Contract**:
- `GET /categories` → 200 `{ id, name, isDefault }[]`: domyślne w kolejności z `DEFAULT_CATEGORIES`, potem własne alfabetycznie; `Cache-Control: no-store`.
- `POST /categories` `{ name }` → 201 `{ id, name, isDefault: false }`; nazwa przycięta, 1–50 znaków; konflikt (bez wielkości liter) z własną lub domyślną → 409.
- `POST /subscriptions` → 201 odpowiedź subskrypcji. Body: `name` (przycięta, 1–100), `categoryId` (domyślna albo własna użytkownika, inaczej 400), `amount` (liczba, ≥ 0, ≤ 99 999,99, maks. 2 miejsca po przecinku), `billingCycle`, `paymentMethod`, `status` (wszystkie 4), `trialEndDate` (`YYYY-MM-DD`, wymagana dla `trial`, zabroniona dla innych statusów), `nextBillingDate` (`YYYY-MM-DD`, zawsze wymagana; dla `trial` nie wcześniejsza niż `trialEndDate`). Daty w przeszłości dozwolone.
- `GET /subscriptions` → 200 lista subskrypcji użytkownika w kolejności `status_then_date`: grupa 0 = `active` i `trial`, 1 = `cancelled_pending`, 2 = `cancelled`; w grupie rosnąco po dacie odniesienia (`trial_end_date` dla `trial`, inaczej `next_billing_date`); remis po `lower(name)`, potem `created_at`. `Cache-Control: no-store`.
- Odpowiedź subskrypcji: `{ id, name, category: { id, name, isDefault }, amount: "43.00", billingCycle, paymentMethod, status, trialEndDate: string | null, nextBillingDate, createdAt }` — `amount` jako string z dwoma miejscami, bez `userId`.
- Moduł rejestruje seeder bazy dev (tylko przy `synchronize`): wstawia kategorie domyślne (`orIgnore`) i tworzy unikalny indeks wyrażeniowy `IF NOT EXISTS` ze wspólnej stałej SQL.

#### 4. Migracje

**File**: `backend-subtracker/src/database/migrations/` (2 nowe pliki)

**Intent**: Schemat i dane startowe na `subtracker-db` i produkcji.

**Contract**: `npm run migration:generate -- SubscriptionsSchema` (po przeglądzie dopisany ręcznie unikalny indeks wyrażeniowy), osobno `npm run migration:create -- SeedDefaultCategories` z 9 wierszami (`user_id NULL`) wpisanymi wprost; obie zastosowane `migration:run` na `subtracker-db`; po zastosowaniu `migration:generate` nie znajduje różnic.

#### 5. Testy

**File**: `backend-subtracker/src/subscriptions/**/*.spec.ts`, `backend-subtracker/test/subscriptions.e2e-spec.ts` (nowe)

**Intent**: Pilnować izolacji kont, walidacji i kolejności.

**Contract**:
- Jednostkowe: walidacja reguł dat i kwoty w DTO; budowanie kolejności (grupy, data odniesienia, remis).
- E2E (prefiks danych `e2e-subscriptions-`, `applyHttpSecurity`, atrapa poczty, sprzątanie subskrypcji i kategorii przed użytkownikami): bez sesji 401 na wszystkich czterech trasach; dodanie i odczyt z kwotą `"43.00"`; użytkownik B nie widzi subskrypcji ani własnych kategorii A i nie może użyć kategorii A (400); reguły dat (trial bez daty końca → 400, `trialEndDate` przy `active` → 400, rozliczenie przed końcem trialu → 400); kwoty `-1`, `100000`, `1.234` → 400, `0` → 201; własna kategoria i konflikt z domyślną „inne”/„INNE” → 409; dwa równoczesne `POST /categories` z tą samą nazwą → jedno 201 i jedno 409 (ścieżka `23505` przez indeks w bazie dev); kolejność dla zestawu 4 subskrypcji w różnych statusach i datach; usunięcie użytkownika usuwa jego subskrypcje i kategorie.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `cd backend-subtracker && npm test`
- Testy e2e przechodzą, w tym `test/subscriptions.e2e-spec.ts`: `npm run test:e2e`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Migracje zastosowane na `subtracker-db`, a `npm run migration:generate -- Check` kończy się komunikatem „No changes in database schema were found”

#### Manual Verification:

- Na bazie dev po starcie API `GET /categories` (zalogowany) zwraca 9 kategorii domyślnych
- Przegląd wygenerowanej migracji: kaskady, indeksy, typy `numeric(10,2)` i `date`, ręczny indeks unikalności

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 2: Frontend — lista subskrypcji

### Overview

Wyświetlenie listy z API w docelowym układzie, z polskim formatowaniem i wszystkimi stanami.

### Changes Required:

#### 1. Locale i formatowanie

**File**: `frontend-subtracker/src/app/app.config.ts`, `src/main.ts` albo `app.config.ts`

**Intent**: Kwoty i daty w formacie polskim w całej aplikacji.

**Contract**: `registerLocaleData(localePl)` i `LOCALE_ID = 'pl-PL'`; kwoty przez `CurrencyPipe`/`Intl` z `PLN` i dwoma miejscami („1 233,87 zł”, „0,00 zł”), daty `dd.MM.yyyy`.

#### 2. Serwis i typy

**File**: `frontend-subtracker/src/app/subscriptions/` (nowy katalog: `subscriptions.service.ts`, `subscription.types.ts`, `subscription-labels.ts`)

**Intent**: Dostęp do API i jedno źródło polskich etykiet.

**Contract**: `SubscriptionsService` (`providedIn: 'root'`, `environment.apiUrl`) z `list()`, `create()`, `categories()`, `createCategory()`; typy odpowiadające kontraktowi API (bez `any`); etykiety: statusy Trial / Aktywna / W trakcie anulowania / Anulowana, cykle Miesiąc / Rok (w liście „miesięcznie” / „rocznie”), formy płatności z FR-004.

#### 3. Lista na desktopie i telefonie

**File**: `frontend-subtracker/src/app/pages/subscriptions/` (+ komponenty potomne), `src/styles/_theme.scss`

**Intent**: Tabela według F2-Lista i lista według F2-Tel-Lista, przełączane media query przy 840 px.

**Contract**:
- Desktop: nagłówek „Twoje subskrypcje” (przycisk „Dodaj subskrypcję” dochodzi w fazie 3 razem z panelem); tabela z kolumnami Nazwa (z kategorią pod spodem), Forma płatności, Status (kolorowy tekst), Kolejna data (data odniesienia; dopisek „koniec triala” dla `trial`, „rozliczenie” dla `active`, „do” dla `cancelled_pending`, „zakończona” dla `cancelled`), Kwota (z dopiskiem „miesięcznie”/„rocznie”).
- Telefon: lista, wiersz to przycisk z `aria-expanded`; linia 1: nazwa i kwota z „/ mies.” lub „/ rok”, linia 2: status, kategoria i data; rozwinięcie pokazuje formę płatności. Przyklejony dolny pasek z „Dodaj subskrypcję” (link do `/subscriptions/new`) dochodzi w fazie 3.
- Dane do testu ręcznego 2.3: tymczasowa sesja w `subtracker-db-dev` (skrypt w scratchpadzie, `sha256` tokenu w `session.token_hash`, jak przy teście SSR w ui-foundation), potem kilka `POST /subscriptions` curlem z ciasteczkiem (bez `Origin`, więc CSRF przepuszcza); po teście sesję usunąć.
- Stany: ładowanie, pusta lista (dotychczasowy tekst „Nie masz jeszcze żadnych subskrypcji.”), błąd API (`.st-notice--error`, `role="alert"`, przycisk „Spróbuj ponownie”), dane.
- Tokeny `--st-status-*` i `--st-line-soft` w `_theme.scss`; style komponentów poniżej 10 kB każdy (podział na komponenty potomne).

### Success Criteria:

#### Automated Verification:

- Build przechodzi bez błędów i bez ostrzeżeń budżetu: `cd frontend-subtracker && npm run build`
- Paczka deployu przechodzi: `npm run prepare-mydevil`

#### Manual Verification:

- Lokalnie z subskrypcjami z fazy 1 (dodanymi przez API): tabela na desktopie i lista na telefonie (390 px) zgodne z makietami, kwoty „43,00 zł”, daty „15.11.2026”, kolejność według grup statusu i dat
- Pusta lista pokazuje pusty stan; przy wyłączonym API komunikat błędu i działające „Spróbuj ponownie”
- Wiersz na telefonie rozwija się i zwija (klawiatura, `aria-expanded`), bez poziomego przewijania strony

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 3: Frontend — dodawanie subskrypcji

### Overview

Formularz z FR-004 w panelu na desktopie i na osobnym ekranie na telefonie, z własną kategorią.

### Changes Required:

#### 1. Formularz

**File**: `frontend-subtracker/src/app/subscriptions/subscription-form/` (nowy komponent współdzielony)

**Intent**: Jeden formularz dla panelu i ekranu telefonu, kolejność pól z makiety F2.

**Contract**:
- Pola: Nazwa (placeholder „np. Netflix”), Kategoria (select: domyślne, własne, „Dodaj własną…”), Kwota w PLN (tekst z `inputmode="decimal"`, placeholder „0,00”, akceptuje przecinek i kropkę), Cykl rozliczeniowy (przełącznik Miesiąc/Rok, domyślnie Miesiąc), Forma płatności (select, 6 pozycji), Status (select, 4 pozycje, domyślnie Aktywna), Koniec okresu próbnego (tylko przy Trial), Następne rozliczenie; przycisk „Zapisz subskrypcję”.
- Walidacja po stronie klienta zgodna z API; komunikaty: „Podaj nazwę.”, „Podaj kwotę od 0 do 99 999,99 zł.”, „Podaj datę w formacie dd.mm.rrrr.”, „Rozliczenie nie może być wcześniejsze niż koniec okresu próbnego.”.
- „Dodaj własną…”: pole nazwy i przycisk „Dodaj”; po `POST /categories` nowa kategoria jest wybrana; 409 → „Taka kategoria już istnieje.”.
- Stany wysyłki jak w formularzach S-01 (`sending` blokuje przycisk; 400 i błąd API jako `.st-notice--error`).

#### 2. Daty

**File**: `frontend-subtracker/src/app/app.config.ts`, `src/app/subscriptions/` (adapter)

**Intent**: Datepicker po polsku z wpisywaniem `dd.mm.rrrr`.

**Contract**: `provideNativeDateAdapter()` na sztywno wstawia `NativeDateAdapter` i nie przyjmie podklasy, więc providery wprost: `{ provide: DateAdapter, useClass: PlDateAdapter }` (podklasa `NativeDateAdapter`, bez konstruktora, z `parse` dla `dd.mm.rrrr` i `d.m.rrrr`, nieistniejąca data jak 31.02 → `null`), `{ provide: MAT_DATE_LOCALE, useValue: 'pl-PL' }`, `{ provide: MAT_DATE_FORMATS, useValue: … }` z `display.dateInput` `{ year: 'numeric', month: '2-digit', day: '2-digit' }` (wyświetla „05.01.2026”, nie „5.01.2026”). Do API `YYYY-MM-DD` z lokalnych części daty.

#### 3. Panel na desktopie

**File**: `frontend-subtracker/src/app/pages/subscriptions/`

**Intent**: Panel „Nowa subskrypcja” według F2-Lista, bez zmian w `AppShell`, jeśli układ strony wystarczy.

**Contract**: przycisk „Dodaj subskrypcję” przy nagłówku (desktop) i przyklejony dolny pasek z linkiem do `/subscriptions/new` (telefon) dochodzą w tej fazie; panel po prawej stronie tabeli z nagłówkiem i przyciskiem zamknięcia (`aria-label="Zamknij panel"`); zamknięty domyślnie, otwarty automatycznie przy pustej liście; od 840 px do ~1200 px wysuwa się nad tabelę zamiast ją ściskać; przycisk „Dodaj subskrypcję” ma `aria-expanded`. Po zapisie: panel się zamyka, nowa pozycja jest na liście w swojej kolejności, komunikat `role="status"` „Dodano subskrypcję „<nazwa>”.”, fokus wraca na przycisk „Dodaj subskrypcję”.

#### 4. Ekran na telefonie

**File**: `frontend-subtracker/src/app/pages/subscription-new/` (nowa strona), `app.routes.ts`, `app.routes.server.ts`

**Intent**: Pełny ekran dodawania według F2-Tel-Dodawanie.

**Contract**: trasa `/subscriptions/new` z `authGuard`, `RenderMode.Client`; nagłówek „Nowa subskrypcja” z linkiem zamknięcia do `/subscriptions`; ten sam formularz; przyklejony dolny pasek z „Zapisz subskrypcję”; po zapisie powrót na `/subscriptions` z komunikatem o dodaniu. Wejście na `/subscriptions/new` na desktopie działa (formularz na pełnej stronie).

### Success Criteria:

#### Automated Verification:

- Build przechodzi bez błędów i bez ostrzeżeń budżetu: `cd frontend-subtracker && npm run build`
- Paczka deployu przechodzi: `npm run prepare-mydevil`
- `dist/frontend-subtracker/browser/` nie zawiera prerenderowanego `subscriptions/new/index.html` (trasa w `RenderMode.Client`)

#### Manual Verification:

- Pełny przepływ lokalnie: pusta lista → panel otwarty sam → dodanie subskrypcji Aktywna i Trial (z końcem trialu) → obie na liście we właściwej kolejności
- Własna kategoria: dodanie, wybór, konflikt z „Inne” pokazuje komunikat
- Walidacja: pusta nazwa, kwota „abc”, „-1”, „100 000”, data „31.02.2026”, rozliczenie przed końcem trialu — komunikaty przy polach, nic nie trafia do API
- Telefon (390 px): „Dodaj subskrypcję” → `/subscriptions/new` → zapis → powrót do listy z komunikatem
- Desktop 1024 px: panel wysuwa się nad tabelę; 1360 px: panel obok tabeli
- Klawiatura i drzewo dostępności: etykiety pól, błędy powiązane z polami, fokus po zapisie

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 4: Wdrożenie i dokumentacja

### Overview

Dokumentacja wzorców, nowy slice usuwania konta, PR, deploy obu aplikacji i testy na produkcji.

### Changes Required:

#### 1. Dokumentacja

**File**: `context/foundation/backend-patterns.md`, `context/foundation/roadmap.md`, `CLAUDE.md` (poza blokiem synchronizowanym)

**Intent**: Zapisać nowe wzorce i decyzje.

**Contract**:
- `backend-patterns.md`: kwoty (`numeric(10,2)`, string w API), daty (`date` jako `YYYY-MM-DD`), kategorie (domyślne z `user_id NULL`, indeks wyrażeniowy z `synchronize: false`), kaskada `user → dane domenowe`, kolejność listy jako enum w serwisie.
- `roadmap.md`: nowy slice „Usunięcie konta” (potwierdzenie z informacją o bezpowrotnej utracie danych, usunięcie sesji, tokenów i danych przez kaskadę, NFR 30 dni) z zależnością od S-02; w S-04 zapisać, że kwota jest kwotą za cykl, a lista zawiera także subskrypcje anulowane.
- `CLAUDE.md`: moduł `subscriptions` w opisie backendu, `/subscriptions/new` w tripwire o trybach renderowania.

#### 2. Pull request i deploy

**File**: —

**Intent**: Użytkownik pushuje `change/first-subscription-in-list`, otwiera PR i scala po zielonym CI; ruszają deploy API (z migracjami w oknie przestoju) i frontendu.

**Contract**: bez zmian w `deploy/mydevil/` i `shared/.env`.

### Success Criteria:

#### Automated Verification:

- CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts`
- Deploy API (z migracjami) i frontendu na `main` przeszły, wraz z health-checkami

#### Manual Verification:

- Na produkcji nowe konto: od wejścia na stronę do pierwszej subskrypcji na liście w mniej niż 3 minuty (z logowaniem linkiem)
- Na produkcji dodanie subskrypcji Trial i Aktywna, własna kategoria, kolejność na liście, format kwot i dat
- Na prawdziwym telefonie: lista, rozwijanie wiersza, dodawanie na osobnym ekranie, bez poziomego przewijania
- Drugie konto nie widzi subskrypcji ani kategorii pierwszego

---

## Testing Strategy

### Unit Tests:

- Walidacja DTO subskrypcji: reguły dat zależne od statusu, zakres i precyzja kwoty, przycinanie nazw.
- Kolejność listy: grupy statusu, data odniesienia, remisy.

### Integration Tests:

- `test/subscriptions.e2e-spec.ts` na polityce produkcyjnej (`applyHttpSecurity`): autoryzacja, izolacja kont, walidacja, kategorie, kolejność, kaskada.
- Kontrola celowego uszkodzenia: usunięcie filtra po `user_id` w liście ma dać czerwony test izolacji; odwrócenie kolejności grup — czerwony test kolejności.

### Manual Testing Steps:

1. Pusta lista → panel otwarty sam → dodanie dwóch subskrypcji → kolejność i formaty.
2. Własna kategoria i konflikt nazw.
3. Walidacja w formularzu (kwota, daty, nazwa).
4. Telefon: lista, rozwijanie, `/subscriptions/new`.
5. Drugie konto: izolacja.

## Performance Considerations

Lista bez paginacji: przy skali MVP (kilkanaście–kilkadziesiąt subskrypcji na konto) jedno zapytanie z sortowaniem po indeksowanym `user_id` wystarcza. `mat-table`, `datepicker` i `select` trafiają do leniwego chunka `/subscriptions`.

## Migration Notes

Dwie nowe migracje (schemat, dane startowe) uruchamiane przez `deploy.sh` po `pg_dump`. Wycofanie: `rollback.sh api` przywraca bazę z kopii. Istniejące dane nie są zmieniane.

## References

- Badanie: `context/changes/first-subscription-in-list/research.md`
- PRD: `context/foundation/prd.md` (FR-004, FR-007, FR-013, FR-018, US-01)
- Roadmapa: `context/foundation/roadmap.md` (S-02 i zależne slice'y)
- Wzorce backendu: `context/foundation/backend-patterns.md`
- Decyzje UI i makiety: `context/archive/2026-11-10-ui-foundation/change.md`, płótno https://claude.ai/artifact/1GnVVi4MbScvb9CFMBT53J (F2-Lista, F2-Tel-Lista, F2-Tel-Dodawanie)

## Follow-ups

- Faza 1, przegląd migracji przez użytkownika (2026-11-11): `subscription.category_id` dostał indeks (reguła „Indeksy tam, gdzie zapytanie albo klucz ich potrzebuje” w `lessons.md`), a domyślne „Streaming wideo” i „Muzyka i audio” połączone w jedną kategorię „Streaming” (usługi typu YouTube obejmują obie) — kategorii domyślnych jest 9. Wiersz Progress 1.6 zachowuje pierwotny tytuł („10 kategorii”); sprawdzana wartość to 9.
- Faza 1, przegląd kodu przez użytkownika (2026-11-11): ogólne helpery wydzielone do `src/shared/` — `validation/date-only.ts` (`isDateOnly`, `IsDateOnly`), `validation/trimmed-string.ts` (`TrimmedString`, wcześniej `TrimmedName`), `database/unique-violation.ts` (`isUniqueViolation`), każdy z testem; `default-categories.ts` przeniesione z `shared/types` do modułu `subscriptions` (reguła „Kod ogólny w `shared/`, logika domeny w module funkcji” w `lessons.md`).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — kategorie, subskrypcje i API

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą: `cd backend-subtracker && npm test` — e905c67
- [x] 1.2 Testy e2e przechodzą, w tym `test/subscriptions.e2e-spec.ts`: `npm run test:e2e` — e905c67
- [x] 1.3 Lint przechodzi: `npm run lint` — e905c67
- [x] 1.4 Build przechodzi: `npm run build` — e905c67
- [x] 1.5 Migracje zastosowane na `subtracker-db`, a `npm run migration:generate -- Check` kończy się komunikatem „No changes in database schema were found” — e905c67

#### Manual

- [x] 1.6 Na bazie dev po starcie API `GET /categories` (zalogowany) zwraca 10 kategorii domyślnych — e905c67
- [x] 1.7 Przegląd wygenerowanej migracji: kaskady, indeksy, typy `numeric(10,2)` i `date`, ręczny indeks unikalności — e905c67

### Phase 2: Frontend — lista subskrypcji

#### Automated

- [x] 2.1 Build przechodzi bez błędów i bez ostrzeżeń budżetu: `cd frontend-subtracker && npm run build`
- [x] 2.2 Paczka deployu przechodzi: `npm run prepare-mydevil`

#### Manual

- [x] 2.3 Lokalnie z subskrypcjami z fazy 1 (dodanymi przez API): tabela na desktopie i lista na telefonie (390 px) zgodne z makietami, kwoty „43,00 zł”, daty „15.11.2026”, kolejność według grup statusu i dat
- [x] 2.4 Pusta lista pokazuje pusty stan; przy wyłączonym API komunikat błędu i działające „Spróbuj ponownie”
- [x] 2.5 Wiersz na telefonie rozwija się i zwija (klawiatura, `aria-expanded`), bez poziomego przewijania strony

### Phase 3: Frontend — dodawanie subskrypcji

#### Automated

- [ ] 3.1 Build przechodzi bez błędów i bez ostrzeżeń budżetu: `cd frontend-subtracker && npm run build`
- [ ] 3.2 Paczka deployu przechodzi: `npm run prepare-mydevil`
- [ ] 3.3 `dist/frontend-subtracker/browser/` nie zawiera prerenderowanego `subscriptions/new/index.html` (trasa w `RenderMode.Client`)

#### Manual

- [ ] 3.4 Pełny przepływ lokalnie: pusta lista → panel otwarty sam → dodanie subskrypcji Aktywna i Trial (z końcem trialu) → obie na liście we właściwej kolejności
- [ ] 3.5 Własna kategoria: dodanie, wybór, konflikt z „Inne” pokazuje komunikat
- [ ] 3.6 Walidacja: pusta nazwa, kwota „abc”, „-1”, „100 000”, data „31.02.2026”, rozliczenie przed końcem trialu — komunikaty przy polach, nic nie trafia do API
- [ ] 3.7 Telefon (390 px): „Dodaj subskrypcję” → `/subscriptions/new` → zapis → powrót do listy z komunikatem
- [ ] 3.8 Desktop 1024 px: panel wysuwa się nad tabelę; 1360 px: panel obok tabeli
- [ ] 3.9 Klawiatura i drzewo dostępności: etykiety pól, błędy powiązane z polami, fokus po zapisie

### Phase 4: Wdrożenie i dokumentacja

#### Automated

- [ ] 4.1 CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts`
- [ ] 4.2 Deploy API (z migracjami) i frontendu na `main` przeszły, wraz z health-checkami

#### Manual

- [ ] 4.3 Na produkcji nowe konto: od wejścia na stronę do pierwszej subskrypcji na liście w mniej niż 3 minuty (z logowaniem linkiem)
- [ ] 4.4 Na produkcji dodanie subskrypcji Trial i Aktywna, własna kategoria, kolejność na liście, format kwot i dat
- [ ] 4.5 Na prawdziwym telefonie: lista, rozwijanie wiersza, dodawanie na osobnym ekranie, bez poziomego przewijania
- [ ] 4.6 Drugie konto nie widzi subskrypcji ani kategorii pierwszego
