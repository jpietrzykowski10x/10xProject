---
date: 2026-11-11T13:25:53+01:00
researcher: Claude (Opus 5.5) z Jakubem Pietrzykowskim
git_commit: 3c48d2a
branch: change/first-subscription-in-list
repository: 10xProject (SubTracker)
topic: "S-02 first-subscription-in-list: wymagania, wzorce backendu i frontendu oraz otwarte decyzje dla dodania subskrypcji i listy"
tags: [research, s-02, subscriptions, backend-subtracker, frontend-subtracker, typeorm, angular-material]
status: complete
last_updated: 2026-11-11
last_updated_by: Claude (Opus 5.5)
---

# Research: S-02 — dodanie subskrypcji i lista subskrypcji

**Date**: 2026-11-11T13:25:53+01:00
**Researcher**: Claude (Opus 5.5) z Jakubem Pietrzykowskim
**Git Commit**: 3c48d2a
**Branch**: change/first-subscription-in-list
**Repository**: 10xProject (SubTracker)

## Research Question

Czego wymagają dokumenty produktu dla slice'u S-02 (`first-subscription-in-list`: „użytkownik dodaje subskrypcję ze wszystkimi szczegółami i widzi ją na liście”), jakie wzorce backendu i frontendu ta zmiana musi powtórzyć, co wprowadza po raz pierwszy i które decyzje są jeszcze otwarte przed `/10x-plan`.

## Summary

- **Zakres pól jest ustalony w PRD** (FR-004, `context/foundation/prd.md:68`): nazwa, kategoria, kwota w PLN, cykl miesięczny/roczny, forma płatności z zamkniętej listy 6 wartości, status, data końca okresu próbnego (dla trialu) i data następnego rozliczenia. Kategoria: predefiniowana lub własna (FR-018, `prd.md:79`). Lista w jednej tabeli ze szczegółami (FR-007, `prd.md:74`). Statusy z FR-013 (`prd.md:95`): `trial → active → cancelled_pending → cancelled`.
- **Backend ma gotowe klocki**: globalny `SessionAuthGuard` (nowe trasy są chronione bez dekoratora), `@CurrentUser()`, globalny `ValidationPipe` z `whitelist`/`forbidNonWhitelisted`, filtr wyjątków, CSRF i wzorzec encji z FK do `user`. Izolację kont robi serwis filtrem po `currentUser.id` (`context/foundation/backend-patterns.md:22`).
- **S-02 wprowadza po raz pierwszy** (w `backend-subtracker/src/` przeszukanym pod `numeric`, `decimal`, `transformer`, `'date'`, `enum:` nie ma trafień): kolumnę pieniężną, kolumny z samą datą, zamknięte listy dla domeny i model kategorii. W tym repo `numeric` z Postgresa wraca jako string, a `date` jako `'YYYY-MM-DD'`, bez żadnego transformera.
- **Frontend ma motyw, wzorzec formularzy i szkielet**, ale brakuje: polskiego locale (`LOCALE_ID`, `registerLocaleData`), adaptera dat dla datepickera, parsowania kwoty z przecinkiem, serwisu danych i miejsca na panel boczny w `AppShell` (jedno `<ng-content>`).
- **Układ jest rozstrzygnięty w F-02 i na makietach F2**: tabela na desktopie, panel dodawania po prawej (zamknięty domyślnie, otwarty przy pustej liście, nad tabelą poniżej ~1200 px), na telefonie lista z rozwijanymi wierszami i osobny pełny ekran dodawania z przyciskiem zapisu na dole.
- **Otwarte decyzje produktowe** (do `/10x-plan`): lista kategorii i model kategorii własnych, statusy dozwolone przy dodawaniu, wymagalność i relacja dat (trial vs następne rozliczenie), precyzja i limity kwoty, kolumny i domyślna kolejność listy, kasowanie subskrypcji razem z kontem.

## Detailed Findings

### Wymagania produktu (PRD, roadmapa)

- FR-004 (`prd.md:68`), cytat: „nazwa, kategoria, kwota w PLN, cykl rozliczeniowy miesięczny/roczny, forma płatności (z zamkniętej listy: karta kredytowa, karta debetowa, BLIK, przelew/zlecenie stałe, portfel elektroniczny, inne), status, data końca okresu próbnego (dla subskrypcji w trialu) i data następnego rozliczenia”. Forma płatności jest polem wymaganym (`prd.md:69`, notatka Socrates).
- FR-018 (`prd.md:79`): kategoria z predefiniowanej listy lub własna. Lista predefiniowana nie jest zdefiniowana — Unknown w roadmapie z właścicielem „user”, nieblokujące (`context/foundation/roadmap.md:133`). Jedyne przykładowe nazwy w repo to Streaming, Praca, Muzyka z ilustracji strony startowej (`context/archive/2026-11-10-ui-foundation/plan.md:254`) oraz Streaming, Muzyka, Praca, „Dodaj własną” na makiecie F2-Lista.
- FR-007 (`prd.md:74`): lista wszystkich swoich subskrypcji w jednej tabeli ze szczegółami. US-01: nowa pozycja widoczna od razu (`prd.md:54`).
- Waluta: tylko PLN (`prd.md:131`, Non-Goals).
- Kryterium sukcesu: < 3 min od wejścia na stronę do pierwszej subskrypcji na liście, łącznie z logowaniem linkiem (`prd.md:33`); ryzyko w roadmapie: „formularz musi być krótki mimo wielu pól” (`roadmap.md:134`).
- Poza S-02 (z roadmapy): sortowanie i filtrowanie (FR-016, `roadmap.md:258`), prognoza budżetu w formularzu (FR-012, `roadmap.md:256`), sumy (S-04), edycja i usuwanie (S-03), automatyczne przejścia statusów (S-05), przypomnienia (S-06), duplikaty i limity (S-07, S-08), panel admina (S-09).

### Co późniejsze slice'y wymagają od tej samej tabeli

- S-03: usuwanie jest twarde i oddzielne od anulowania (FR-005, FR-006, `prd.md:70-73`), więc kolumna „usunięto” nie jest potrzebna.
- S-04: sumy miesięczne i roczne per kategoria, zgodne z ręcznym wyliczeniem w 100% (`prd.md:34`); otwarte, czy trial i `cancelled_pending` liczą się do sum (`roadmap.md:158`). Kwota jest więc kwotą za cykl, a przeliczenie rocznej na miesiąc to sprawa S-04.
- S-05: przejścia `trial → active` po końcu trialu i `cancelled_pending → cancelled` po dacie następnego rozliczenia (FR-013, `prd.md:95`); joby mają być idempotentne i nadrabiać zaległe (`context/foundation/lessons.md`, reguła o zadaniach cyklicznych), co sprzyja indeksom na statusie i datach. Strefa czasowa otwarta (`roadmap.md:171-172`), `infrastructure.md:76,102` sugeruje `Europe/Warsaw` albo UTC.
- S-06: jeden mail 7 dni przed końcem trialu (FR-014, `prd.md:97`) z trwałym znacznikiem wysyłki (`infrastructure.md:102`, `reminder_sent_at`) — może dojść migracją w S-06.
- S-07 i S-08: próg duplikatów per kategoria (domyślnie 2 aktywne, FR-009, `prd.md:82`) i limity per kategoria (FR-010, `prd.md:86`). Wniosek: kategoria potrzebuje stabilnej tożsamości (wpis w tabeli albo znormalizowany klucz), żeby grupowanie i limity nie rozjeżdżały się na wielkości liter czy literówkach.
- S-09: dostęp admina tylko przez osobne kontrolery `/admin/...` z `@Roles(ADMIN)` (`backend-patterns.md:22,55`).
- NFR: usunięcie lub anonimizacja danych w 30 dni od prośby o usunięcie konta (`prd.md:108`) — przemawia za kaskadą `user → subscription`, choć w repo wszystkie FK są dziś `NO ACTION` (`backend-subtracker/src/database/migrations/1793732263880-AuthAndMailSchema.ts`).

### Backend: wzorce do powtórzenia

- Moduł per funkcja z `controllers/`, `services/`, `dtos/`, `entities/` (`backend-patterns.md:87`); wzór: `backend-subtracker/src/auth/auth.module.ts:13-23`; rejestracja w `src/app.module.ts:28-30`; encje ładowane przez `autoLoadEntities` (`app.module.ts:22`), CLI migracji szuka `**/*.entity.js` (`src/database/database.options.ts:62`).
- Globalnie: `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` (`app.module.ts:36-43`), `SafeLoggingExceptionFilter` (4xx bez logu, `src/shared/filters/safe-logging-exception.filter.ts:29-63`), `APP_GUARD` = `SessionAuthGuard` + `RolesGuard` (`src/auth/auth.module.ts:19-21`).
- Bieżący użytkownik: `@CurrentUser() user: AuthUser` (`src/shared/decorators/current-user.decorator.ts:9-17`, typ w `src/shared/types/auth-user.ts:4-8`); przykład użycia `src/auth/controllers/auth.controller.ts:71-75`. `userId` ustawia serwis z `@CurrentUser`, nigdy z body.
- Kontrolery: jawne `@HttpCode`, typowane odpowiedzi, `@Header('Cache-Control', 'no-store')` na GET z danymi użytkownika (`auth.controller.ts:66,72`). Brak `ClassSerializerInterceptor`, więc encję trzeba mapować na typ odpowiedzi.
- Encje: `@PrimaryGeneratedColumn('uuid')`, kolumny z jawnym `name` w `snake_case` i `type`, `timestamptz`, stałe długości eksportowane obok encji (`src/users/entities/user.entity.ts:11`, `src/auth/entities/session.entity.ts:13`). FK do użytkownika: indeksowane `user_id` + `@ManyToOne(() => User)` + `Relation<User>` (`session.entity.ts:21-27`).
- Zamknięte listy: `varchar(n)` + enum TS, bez enumów Postgresa (`src/users/entities/role.entity.ts:10-11`, `src/mail/entities/mail.entity.ts:18-25`).
- DTO: class-validator, grupy przez `applyDecorators` (`src/auth/dtos/request-link.dto.ts:11-19`); `@Transform` przed walidacją jest dziś tylko dla e-maila — przycinanie nazw to nowość.
- Migracje: `npm run migration:generate -- <Nazwa>` względem `subtracker-db`, przegląd, `migration:run`, commit z kodem (`lessons.md`, reguła o migracjach). Dane startowe osobną migracją z wartościami wpisanymi wprost (`src/database/migrations/1793732271790-SeedRoles.ts`) i idempotentnym seederem dla bazy dev (`src/users/services/roles-seeder.ts:21-32`).
- Testy: jednostkowe w `src/**/*.spec.ts` z ręcznie stubowanymi repozytoriami (`src/mail/services/mail.service.spec.ts:43-61`); e2e w `test/` szeregowo na bazie dev, z `applyHttpSecurity`, atrapą `MAIL_TRANSPORT` i sprzątaniem po prefiksie adresu (`test/auth.e2e-spec.ts:26-57,133-165`). Helper `signIn` nie jest wyeksportowany (`auth.e2e-spec.ts:118-122`).

### Backend: co S-02 wprowadza po raz pierwszy

- Pierwsza encja domenowa z FK do `user` poza modułem auth; decyzja o `onDelete: 'CASCADE'` vs domyślne `NO ACTION`.
- Pierwsza kolumna pieniężna: `numeric(p,2)` wraca z node-pg jako string (w repo brak `setTypeParser` i `ValueTransformer`); alternatywa to grosze w `integer`. DTO wejściowe: `@IsNumber({ maxDecimalPlaces: 2 })` + `@IsPositive` + górny limit albo string z regexem.
- Pierwsze kolumny z samą datą: `type: 'date'` wraca jako `'YYYY-MM-DD'`, bez przesunięć strefy; walidacja `@IsDateString({ strict: true })` lub regex, warunkowo `@ValidateIf` dla daty końca trialu.
- Pierwsze zamknięte listy domeny (cykl, forma płatności, status) — według wzorca `varchar` + enum TS + `@IsEnum`.
- Kategorie: albo `varchar` z listą predefiniowaną w kodzie i frontendzie, albo tabela z migracją danych i seederem (precedens ról).
- Pierwszy plik e2e z zalogowanym użytkownikiem poza auth: nowy prefiks danych testowych (np. `e2e-subscriptions-`) i sprzątanie subskrypcji przed użytkownikami (FK `NO ACTION`).

### Frontend: na czym budować

- Trasa `/subscriptions` z `authGuard`, ładowana leniwie (`frontend-subtracker/src/app/app.routes.ts:30-34`), w `RenderMode.Client` (`app.routes.server.ts:28-31`); fallback `'**'` → Prerender (`app.routes.server.ts:32-35`). SSR (`RenderMode.Server`) ma tylko `/` (`app.routes.server.ts:9-11`). Nowa trasa (np. pełny ekran dodawania na telefonie) potrzebuje angielskiej ścieżki i własnego wpisu `Client`.
- HTTP: `AuthService` jako wzór serwisu (`src/app/auth/auth.service.ts:18-53`); `credentialsInterceptor` dodaje `withCredentials` do każdego URL pod `environment.apiUrl` (`src/app/auth/credentials.interceptor.ts:4-10`), więc nowy serwis dostaje ciasteczko bez dodatkowego kodu.
- Szkielet: `AppShell` z jednym slotem `<ng-content />` w `<main class="shell__content">` (`src/app/layout/app-shell/app-shell.html:40-47`), przełączenie telefon/desktop media query przy 840 px (`app-shell.scss:115-132`). Brak slotu na panel boczny i na przyklejony dolny pasek.
- Strona listy dziś: nagłówek, komentarz „The add button arrives with S-02”, pusty stan w białym panelu (`src/app/pages/subscriptions/subscriptions.html:1-5`, `subscriptions.scss:7-16`).
- Formularze: `NonNullableFormBuilder`, stan w sygnale z unią stanów, `mat-form-field`/`mat-error`, komunikaty `.st-notice` z `role` (`src/app/pages/register/register.ts:13-54`, `register.html:12-27`, `src/styles/_forms.scss`, `src/styles/_notices.scss`).
- Motyw: pełna paleta M3 przypięta w `src/styles/_theme.scss:47-103`; pola 48 px (`:106`), zielony `mat-flat-button` 48 px (`:115-125`), kształt przełącznika (`:127-131`), tokeny `--st-*` (`:135-153`). `secondary-container` `#dce3f0` (`:63`) odpowiada zaznaczeniu przełącznika Miesiąc/Rok z makiety. Brak tokenów na kolory statusów i linię wierszy (`$line-soft` istnieje tylko w Sass).
- Zależności: Material 22.2.6 z `table`, `datepicker`, `select`, `button-toggle`, `sidenav`; brak adapterów dat poza wbudowanym natywnym; `@angular/common/locales/pl` jest w paczce, ale nie jest zarejestrowane.

### Frontend: braki do uzupełnienia w S-02

- Locale `pl-PL` (`registerLocaleData` + `LOCALE_ID`) dla kwot „43,00 zł” i dat „18.11.2026” albo `Intl.NumberFormat`.
- Datepicker: `provideNativeDateAdapter()` + `MAT_DATE_LOCALE`; natywny adapter nie parsuje wpisanego `dd.mm.rrrr`, więc potrzebne nadpisanie `parse`, adapter z zależnością albo wybór tylko z kalendarza. Do API wysyłać `YYYY-MM-DD`, nie `toISOString()`.
- Kwota z przecinkiem dziesiętnym (`inputmode decimal`, placeholder „0,00”).
- Serwis `SubscriptionsService` i stany listy: ładowanie, pusta, błąd API, dane.
- Panel boczny i dolny pasek: zmiana w `AppShell` albo `mat-sidenav-container` na poziomie strony.
- Budżet stylów komponentu 10/25 kB (`angular.json:77-88`) — lista, tabela, panel i układ telefonu w jednym pliku SCSS mogą przekroczyć 10 kB; podział na komponenty potomne.

## Code References

- `context/foundation/prd.md:68-69` — FR-004, pola subskrypcji i zamknięta lista form płatności
- `context/foundation/prd.md:74,79,95` — FR-007 (lista), FR-018 (kategorie), FR-013 (statusy i przejścia)
- `context/foundation/roadmap.md:126-134` — S-02: Outcome, Unknown o kategoriach, ryzyko długości formularza
- `backend-subtracker/src/auth/auth.module.ts:13-23` — wzór modułu i globalne guardy
- `backend-subtracker/src/shared/decorators/current-user.decorator.ts:9-17` — `@CurrentUser()`
- `backend-subtracker/src/auth/entities/session.entity.ts:21-27` — wzór FK do `user` z indeksem i `Relation<User>`
- `backend-subtracker/src/mail/entities/mail.entity.ts:18-25` — zamknięte listy jako `varchar` + enum TS
- `backend-subtracker/src/database/migrations/1793732271790-SeedRoles.ts` — migracja danych startowych
- `backend-subtracker/src/users/services/roles-seeder.ts:21-32` — seeder dla bazy dev
- `backend-subtracker/test/auth.e2e-spec.ts:26-57,118-122,133-165` — e2e: prefiks danych, `signIn`, setup
- `frontend-subtracker/src/app/app.routes.server.ts:9-35` — tryby renderowania
- `frontend-subtracker/src/app/auth/auth.service.ts:18-53` — wzór serwisu HTTP
- `frontend-subtracker/src/app/layout/app-shell/app-shell.html:40-47` — jedyny slot treści szkieletu
- `frontend-subtracker/src/app/pages/register/register.ts:13-54` — wzór formularza i stanów
- `frontend-subtracker/src/styles/_theme.scss:47-153` — paleta, nadpisania komponentów, tokeny

## Architecture Insights

- Bezpieczeństwo jest domyślne: nowa trasa API jest chroniona przez globalny guard i CSRF bez dodatkowego kodu; jedynym obowiązkiem modułu jest filtr po `currentUser.id` i nieprzyjmowanie `userId` z body.
- Konwencja „`varchar` + enum TS” zamiast enumów Postgresa upraszcza późniejsze zmiany list (np. nowa forma płatności to zmiana kodu, nie `ALTER TYPE`).
- Typy z bazy (`numeric` → string, `date` → string) wymagają świadomej decyzji na granicy API; frontend i tak formatuje kwoty i daty po swojej stronie.
- Frontend przełącza układ telefonu CSS-em przy 840 px; `/subscriptions` jest `Client`, więc `BreakpointObserver` jest tu technicznie możliwy, ale spójność z szkieletem przemawia za CSS.

## Historical Context (from prior changes)

- `context/archive/2026-11-10-ui-foundation/change.md:12-23` — kierunek F2, kolory statusów i akcji, układ desktop/telefon, zachowanie panelu dodawania, rozwijany wiersz listy (S-02/S-03); zgodne z obecnym kodem szkieletu.
- `context/archive/2026-11-10-ui-foundation/plan.md:19,36,39-40` — motyw obejmuje select, table, button-toggle i sidenav „ale tych komponentów jeszcze nie budujemy”; formularz, lista, panel i przełącznik 1200 px przypisane do S-02; ikony jako inline SVG.
- `context/archive/2026-11-10-ui-foundation/reviews/impl-review-phase-1.md:22,43` — `select-overrides` nie ma tokenu kształtu; kolor zaznaczenia przełącznika do sprawdzenia przy pierwszym użyciu w S-02.
- `context/archive/2026-11-11-csrf-protection/` — CSRF wdrożone; nowe trasy zmieniające stan nie potrzebują nic więcej.
- Makiety F2-Lista, F2-Tel-Lista, F2-Tel-Dodawanie (płótno https://claude.ai/artifact/1GnVVi4MbScvb9CFMBT53J, odczytane 2026-11-11):
  - Desktop: przycisk „Dodaj subskrypcję” obok nagłówka; tabela z kolumnami Nazwa (z kategorią pod spodem), Forma płatności, Status (kolorowy tekst), Kolejna data (z dopiskiem „rozliczenie” / „koniec triala, za 4 dni”), Kwota (z dopiskiem „miesięcznie” / „rocznie, 35,83 zł mies.”).
  - Panel „Nowa subskrypcja” z polami w kolejności: Nazwa, Kategoria (select + „Dodaj własną”), Kwota w PLN, Cykl (przełącznik Miesiąc/Rok), Forma płatności (select, 6 pozycji z FR-004), Status (select: Aktywna, Trial), Następne rozliczenie (`dd.mm.rrrr`); przycisk „Zapisz subskrypcję”; komunikat błędu kwoty „Podaj kwotę większą od zera.”.
  - Makieta nie pokazuje pola „koniec okresu próbnego” w formularzu, choć FR-004 go wymaga dla trialu, ani pustego stanu listy.

## Related Research

Nie dotyczy — to pierwszy dokument `research.md` w `context/changes/**` i `context/archive/**` dotyczący subskrypcji.

## Open Questions

Decyzje produktowe do rozstrzygnięcia w `/10x-plan`:

1. **Kategorie**: lista predefiniowana na start (roadmapa: właściciel „user”) i model kategorii własnych — tekst przy subskrypcji czy tabela kategorii (per użytkownik, unikalność bez rozróżniania wielkości liter). Wpływa na S-07 i S-08.
2. **Statusy przy dodawaniu**: makieta proponuje tylko Aktywna i Trial; FR-004 nie ogranicza. Czy `cancelled_pending`/`cancelled` mają być wybieralne przy tworzeniu?
3. **Daty**: czy „następne rozliczenie” jest wymagane dla każdego statusu; jak ma się do daty końca trialu (równa, późniejsza, puste w trialu); pole końca trialu brakuje na makiecie; czy daty w przeszłości są dozwolone.
4. **Kwota**: precyzja (2 miejsca), czy 0 jest dozwolone (darmowy trial), górny limit; przechowywanie `numeric(10,2)` vs grosze.
5. **Lista**: kolumny (makieta daje 5) i domyślna kolejność (np. najbliższa data, nazwa, data dodania); sortowanie przez użytkownika jest poza S-02 (FR-016).
6. **Usunięcie konta**: `ON DELETE CASCADE` dla subskrypcji czy zostawić `NO ACTION` do czasu S-09.
7. **Telefon**: osobna trasa dla pełnego ekranu dodawania (np. `/subscriptions/new`, `RenderMode.Client`) czy stan na tej samej stronie.

Kwestie techniczne do rozstrzygnięcia w planie bez użytkownika: format kwoty w API, adapter dat, miejsce panelu (`AppShell` vs strona), podział komponentów pod budżet stylów.
