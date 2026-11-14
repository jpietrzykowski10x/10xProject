# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-11-14

## 1. Strategy

Testy w tym projekcie podlegają trzem nienegocjowalnym zasadom:

1. **Koszt × sygnał.** Wygrywa najtańszy test, który daje rzeczywisty sygnał
   dla danego ryzyka. Nie promujemy do e2e, bo e2e „wydaje się bezpieczniejsze”.
   Nie kładziemy modelu wizji na deterministyczny diff, który już łapie regresję.
2. **Obawy użytkownika są dowodem.** Ryzyka zakotwiczone w „zespół obawia się X,
   a awaria ujawniłaby się gdzieś w <obszarze>” mają tę samą wagę co linie PRD
   lub dane hot-spotów.
3. **Ryzyka to scenariusze, nie miejsca w kodzie.** Ten plan opisuje, *co może
   się zepsuć* i *dlaczego uważamy to za prawdopodobne* — na podstawie dokumentów,
   wywiadu i *sygnału* z kodu (częstotliwość zmian, struktura, baza testów). NIE
   twierdzi, która linia odpowiada za awarię. Tę wiedzę wytwarza `/10x-research`
   w każdej fazie wdrożenia. Jeśli plan i research nie zgadzają się co do miejsca
   awarii, rację ma research.

Hot-spot scope used for likelihood weighting: `backend-subtracker/src`, `frontend-subtracker/src`, `deploy/`, `dev-local/` (bez lockfile, `dist`, migracji i wygenerowanej palety; 29 commitów / 30 dni do 2026-11-13).

## 2. Risk Map

Najważniejsze scenariusze awarii, uporządkowane wg ryzyka = wpływ × prawdopodobieństwo.
Numery są stałymi identyfikatorami (odwołują się do nich §3 i researche faz); ryzyko dodane
przy refreshu dostaje kolejny numer zamiast przenumerowania, więc kolejność wg ryzyka
obowiązuje wewnątrz pierwotnego zestawu #1–#6.
Ryzyka są scenariuszami w kategoriach użytkownika i biznesu, nie nazwami testów.
Kolumna Source cytuje *dowód, który podniósł ryzyko* — nigdy konkretny plik jako
„miejsce awarii” (to zadanie researchu, §1 zasada 3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Użytkownik odczytuje, zmienia lub usuwa subskrypcje albo kategorie innego konta — endpoint sprawdza zalogowanie, a nie własność zasobu (IDOR) | High | High | PRD Guardrails i Access Control; interview Q1; roadmap S-03 i S-10 (nowe trasy po id), S-09 (wyjątek od izolacji dla admina) |
| 2 | Guard wpuszcza wylogowanego na stronę zalogowanego albo więzi zalogowanego na stronie publicznej; serwer (SSR) i przeglądarka podejmują różne decyzje; HTML zalogowanego trafia do cache | High | High | interview Q3; archive 2026-11-10-ui-foundation (przeglądy: guard przy prerenderze, przekazywanie ciasteczka); hot-spot dir `frontend-subtracker/src/app/auth` (11 zmian plików / 30 dni) |
| 3 | Formularz odrzuca poprawną kwotę lub datę albo wysyła do API inną wartość niż wpisana (separator dziesiętny, `d.m.rrrr`, nieistniejące daty, przesunięcie strefy) | High | High | interview Q2 (regex kwoty odrzucał każdą wartość); archive 2026-11-11-first-subscription-in-list; hot-spot dir `frontend-subtracker/src/app/shared` (12); research fazy 1 (parsowanie w katalogach `shared` i `subscriptions`, nie w `pages`) |
| 4 | Kwota miesięczna lub roczna różni się od ręcznego wyliczenia (roczne ↔ miesięczne, zaokrąglenia, wliczane statusy) | High | Medium | PRD Success Criteria (100% zgodności sum); roadmap S-04 (Risk, Unknowns), S-08; decyzja produktowa 2026-11-13: kwota miesięczna zaokrąglana do grosza per subskrypcja, połówka w górę |
| 5 | Na produkcji (`C.UTF-8`) sortowanie lub unikalność nazw kategorii z polskimi literami działa inaczej niż lokalnie — testy przechodzą, produkcja ma duplikaty lub złą kolejność | Medium | High | interview Q2; archive 2026-11-11-first-subscription-in-list (locale bazy, klucz nazwy); CLAUDE.md Tripwires (lokalne e2e tego nie złapią) |
| 6 | Nadużycie logowania: magic link działa ponownie lub po terminie, wygasła sesja daje dostęp | High | Low | PRD US-01 Acceptance Criteria; archive 2026-11-03-magic-link-sign-in (przeglądy: liczba wysyłek, współbieżne verify); interview Q4 (backend dobrze pokryty); zalew maili przeniesiony do §7 (research fazy 3, decyzja 2026-11-13) |
| 7 | Ekran lub komponent nie renderuje się albo element warunkowy (pole końca trialu, pole własnej kategorii) lub komunikat walidacji nie pojawia się wtedy, kiedy powinien — użytkownik nie może dodać subskrypcji i nie wie dlaczego | High | High | refresh interview 2026-11-13 Q1 (komponent się nie pokazuje, brak widocznych komunikatów walidacji), Q3 (zmiany wszędzie, dochodzą nowe komponenty), Q4 (najpierw formularz subskrypcji); hot-spot dir `frontend-subtracker/src/app/pages` (67 zmian plików / 30 dni, najwięcej w zakresie; dotyczy stron — formularz subskrypcji leży w `frontend-subtracker/src/app/subscriptions` i miał 3 zmiany, więc dla formularza dowodem są wywiad i archiwum, wg researchu fazy 2); archive 2026-11-11-first-subscription-in-list (błąd kwoty widoczny dopiero w UI); roadmap S-03, S-04, S-08, S-09, S-10 (nowe ekrany i formularze) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Konto B dostaje 404/403 przy każdym odczycie i zapisie zasobu konta A; lista B nie zawiera danych A | „zalogowany = uprawniony”; „test listy wystarcza, choć dochodzą trasy po id” | wszystkie trasy przyjmujące id zasobu; jak zapytania zawężają po właścicielu; istniejące e2e na dwóch kontach | integracja API (e2e backendu na prawdziwej bazie) | test na jednym koncie (tylko happy path) |
| #2 | Dla {serwer, przeglądarka} × {brak ciasteczka, ważna sesja, wygasła sesja, API nie odpowiada} guard daje oczekiwane przekierowanie; strona zalogowanego nie jest cache'owana | „działa w `ng serve`, więc działa w SSR” | render mode każdej trasy; przekazywanie ciasteczka do API; limit czasu; nagłówki cache | unit guardów (makieta na granicy HTTP; „wygasła sesja” = 200 z `user: null`, nie 401) + e2e na zbudowanym serwerze SSR dla render mode, cache i 2–3 przejść | mockowanie wnętrza guarda zamiast granicy HTTP |
| #3 | Tabela wejść w polskim formacie (np. `12,99`, `1 299,00`, `05.01.2027`, `29.02.2028`) daje oczekiwane wartości wysłane do API, a nieistniejące daty (`29.02.2027` — 2027 nie jest przestępny, `31.02.2027`) jawne odrzucenie | „regex przepuszcza przykład z planu, więc przepuszcza wszystkie”; „zielony test w CI (UTC) dowodzi braku przesunięcia doby” — test daty musi biec w strefie innej niż UTC (na wschód i na zachód); „unit testy parserów dowodzą, że formularz wysyła wpisaną wartość” — formularz musi mieć podpięty polski adapter dat (bez niego `05.01.2027` jest czytane jako 1 maja) | helpery parsowania kwot i dat; kontrakt API dla kwoty i daty; jak pole formularza dostaje parser dat | unit (parsery) + test komponentu (tekst wpisany w pole → ciało żądania na granicy HTTP) | oczekiwana wartość przepisana z implementacji (problem wyroczni) |
| #4 | Kwota miesięczna subskrypcji rocznej równa się ręcznemu wyliczeniu: grosze / 12, zaokrąglone do grosza, połówka w górę; od S-04 sumy zgadzają się co do grosza | „kwota podzielna przez 12 dowodzi poprawności zaokrąglenia” — wyrocznia musi objąć resztę i połówkę grosza | gdzie liczona jest kwota i suma (front czy API); które statusy się wliczają (S-04) | unit z wyrocznią policzoną ręcznie | skopiowany wzór z kodu produkcyjnego |
| #5 | W bazie `C.UTF-8` (jak produkcja) nazwy różniące się wielkością polskich liter są duplikatem, a sortowanie jest polskie | „lokalna baza zachowuje się jak produkcyjna” | locale bazy w CI; collation w zapytaniach; klucz nazwy kategorii | e2e backendu na Postgresie `C.UTF-8` w CI | test uruchamiany tylko na lokalnym `Polish_Poland.1250` |
| #6 | Drugie użycie linku i link po terminie są odrzucane; wygasła sesja dostaje 401 | „istniejące testy chodzą w CI” (od §3 Phase 3 chodzą: job `backend-e2e`, required) | obecne pokrycie e2e auth; co faktycznie uruchamia CI | e2e backendu (istnieją) + bramka w CI | dopisywanie testów, które już istnieją |
| #7 | Dla każdego stanu formularza element warunkowy jest albo go nie ma; po błędnym wpisie i próbie zapisu komunikat przy polu jest widoczny (bez sprawdzania treści); każdy komponent da się utworzyć | „testy walidatorów dowodzą, że komunikat się wyświetla”; „»should create« dowodzi, że formularz działa” | kiedy Material pokazuje błąd pola; jak pola warunkowe są pokazywane i włączane; providery testowe (locale, animacje, breakpointy w jsdom) | test komponentu (TestBed + jsdom, harnessy Angular Material), API zastąpione na granicy HTTP | asercja dokładnej treści komunikatu, położenia lub snapshotu; mockowanie wnętrza formularza |

## 3. Phased Rollout

Każdy wiersz to osobna faza wdrożenia, która otwiera własny folder zmiany
przez `/10x-new`. Status przesuwa się w prawo zgodnie ze słownikiem poniżej;
orkiestrator aktualizuje go, gdy artefakty pojawiają się na dysku.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Frontend unit tests (roadmap F-03) | Runner i bramka CI na froncie; dowód, że parsowanie kwot i dat, przeliczenie na miesiąc i decyzje guardów nie przepuszczają złych wartości | #3, #2, #4 | unit | complete | context/changes/frontend-unit-tests/ |
| 2 | Frontend component tests | »Should create« dla wszystkich komponentów i dowód, że formularz subskrypcji pokazuje pola warunkowe i komunikaty walidacji wtedy, kiedy powinien; `skipTests: false` dla schematu komponentu | #7, #3 | component | complete | context/changes/frontend-component-tests/ |
| 3 | Account isolation and backend e2e in CI | e2e backendu w CI na Postgresie `C.UTF-8`; dowód, że żadna trasa po id nie zwraca ani nie zmienia cudzych danych | #1, #5, #6 | integration (API e2e), CI gate | researched | context/changes/backend-e2e-account-isolation/ |
| 4 | Critical browser paths | 2–3 przejścia na zbudowanym SSR: przekierowania guardów, brak cache stron zalogowanego, dodana subskrypcja widoczna na liście | #2, #1 | e2e | not started | — |
| 5 | Agent-loop hooks | lint, typecheck i unit uruchamiane po edycji i na koniec tury agenta | cross-cutting | post-edit hook | not started | — |

## 4. Stack

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit (backend) | Vitest | ^4.1.2 | `backend-subtracker/src/**/*.spec.ts`, 20 plików; w CI |
| integration / API e2e (backend) | Vitest + Supertest | ^4.1.2 / ^7.0.0 | `backend-subtracker/test/`, 11 plików `*.e2e-spec.ts` (79 testów) na prawdziwym Postgresie, wspólny pomocnik w `test/support/`; w CI (job `backend-e2e`: Postgres 16 `C.UTF-8`, schemat z migracji) |
| unit (frontend) | Vitest + jsdom przez `@angular/build:unit-test` | ^4.1.12 / ^31.0.1 | `frontend-subtracker/src/**/*.spec.ts`; `npm run test:ci` uruchamia zestaw w `Europe/Warsaw` i `America/New_York`; w CI |
| component (frontend) | TestBed (zoneless) + harnessy Angular Material/CDK, w runnerze unit | 22.2.6 | spec obok każdego komponentu (12); globalne providery w `src/test-providers.ts` (`providersFile`); makieta tylko na granicy HTTP; biegnie w `test:ci` w obu strefach; checked: 2026-11-13 |
| e2e (przeglądarka) | none yet — see Phase 4 | — | kandydat: Playwright (lekcja m3l4) |
| accessibility | none | — | poza zakresem rolloutu; kontrole ręczne przy `/10x-ui` |
| (optional) AI-native | post-edit hook w Claude Code — checked: 2026-11-13 | n/a | When NOT to use: jako zamiennik bramki CI albo z testami trwającymi dłużej niż kilka sekund |

Profil bazy testów: `sparse` — backend ma Vitest (20 plików unit, 11 plików e2e w CI na `C.UTF-8`, w tym strażnik listy tras i test dwóch kont); frontend ma runner, 12 plików testów jednostkowych (czyste funkcje, guardy, interceptory i strażnik strefy) i 12 plików testów komponentów (»should create« każdego komponentu; zachowanie formularza subskrypcji i `register`).

**Stack grounding tools (current session):**
- Docs: none — Context7 ani inny MCP dokumentacji nie jest dostępny w tej sesji; wersje z `package.json`; checked: 2026-11-13
- Search: WebSearch (wbudowany) — nieużyty przy pisaniu planu; do potwierdzenia runnera Angulara 22 w researchu fazy 1; checked: 2026-11-13
- Runtime/browser: Claude in Chrome — not used; ewentualnie do eksploracji w fazie 4; checked: 2026-11-13
- Provider/platform: GitHub (`gh`, token tylko do odczytu) — odczyt wyników CI; checked: 2026-11-13

## 5. Quality Gates

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint (backend, oxlint type-aware) | local + CI | required | dryf typów i składni w API |
| build frontendu (typecheck AOT) | CI | required | błędy typów i szablonów frontu |
| unit backend | local + CI | required | regresje logiki API |
| unit frontend | local + CI | required | regresje parsowania, przeliczeń i guardów; od §3 Phase 2 także zepsute renderowanie komponentów i niewidoczne komunikaty walidacji |
| API e2e backendu na Postgresie `C.UTF-8` | CI on PR (job `backend-e2e`) | required | wyciek między kontami, różnice locale, regresje auth, trasa dodana bez wpisu na liście tras |
| e2e w przeglądarce (krytyczne ścieżki) | CI on PR | required after §3 Phase 4 | zepsute przekierowania SSR i główny przepływ |
| post-edit hook | local (agent loop) | recommended after §3 Phase 5 | regresje w chwili edycji |

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Każda podsekcja jest uzupełniana, gdy
odpowiednia faza wdrożenia zostanie dostarczona; wcześniej brzmi „TBD — see §3 Phase <N>.”

### 6.1 Adding a frontend unit test

- **Location**: `*.spec.ts` obok testowanego pliku w `frontend-subtracker/src/`. Helper w `src/app/shared/` zawsze dostaje test obok. Logikę wyjętą z komponentu (np. budowę żądania) przenieś do czystej funkcji w module funkcji i testuj ją bez TestBed.
- **Naming**: `describe` = nazwa jednostki (`monthlyAmount`, `guestGuard`). Przypadki jako `it.each` z tabelą wejście → wynik; nazwa testu mówi, co jednostka robi z wejściem (`divides a yearly %j into %j a month`). Nad tabelą komentarz ze źródłem wyroczni: kontrakt API (DTO backendu), reguła z §2 albo kalendarz, nigdy obecny kod.
- **Reference tests**:
  - `src/app/subscriptions/subscription-validators.spec.ts` — tabele przyjętych i odrzuconych wpisów z wyrocznią z DTO; spacje twarde zapisane jako `\u00A0` / `\u202F`, nie jako surowe znaki.
  - `src/app/subscriptions/subscription-amounts.spec.ts` — wyrocznia policzona ręcznie, rachunek w komentarzu przy każdym wierszu.
  - `src/app/shared/date-only.spec.ts` — daty: oczekiwany dzień kalendarzowy, a nie wynik `Date`; zestaw biegnie w dwóch strefach.
  - `src/app/auth/auth.guard.spec.ts` — TestBed z `provideHttpClientTesting()`; makieta tylko na granicy HTTP (`HttpTestingController`), `AuthService` i `Router` prawdziwe; `PLATFORM_ID` i `REQUEST` jako providery; fake timery Vitest przywracane w `afterEach` razem z `httpTesting.verify()`.
- **Run locally** (z `frontend-subtracker/`): cały zestaw `npm test -- --watch=false`; jeden plik `npx ng test --include src/app/subscriptions/subscription-amounts.spec.ts --watch=false` (w strefie maszyny); obie strefy, tak jak w CI: `npm run test:ci`. Test zależny od strefy musi przechodzić w `Europe/Warsaw` i `America/New_York`. Gdy w powłoce jest ustawione `TZ`, musi to być jedna z tych dwóch stref — inaczej test-strażnik strefy (`src/test-time-zone.spec.ts`) odpada.
- **Sabotage check**: przed commitem uszkodź testowany kod w working tree (np. `Math.round` → `Math.floor`), uruchom jeden plik, zobacz czerwony test, cofnij `git checkout -- <plik>`. Test, który zostaje zielony, niczego nie pilnuje.

### 6.2 Adding a component test

- **Location**: `<komponent>.spec.ts` obok komponentu. `ng generate component` tworzy go sam (`skipTests: false` tylko dla schematu komponentu). Minimum dla każdego komponentu to »should create«, a test zachowania dochodzi tam, gdzie §2 wskazuje ryzyko (pola warunkowe, komunikaty, wartość wysyłana do API).
- **Providers**: globalne są w `src/test-providers.ts` (`providersFile` w `angular.json`): `LOCALE_ID` `pl-PL` z `localePl` jak w `app.config.ts` oraz `MATERIAL_ANIMATIONS` z `animationsDisabled`, bo jsdom nie kończy animacji. W specu dodaj tylko to, czego komponent potrzebuje: `provideHttpClient()` + `provideHttpClientTesting()`, gdy on lub jego dzieci wołają API, oraz `provideRouter([])`, gdy on lub jego layout ma `RouterLink`/`Router`. Wymagany input ustawiasz przez `fixture.componentRef.setInput(...)`. Nie mockuj serwisów ani wnętrza komponentu, zastępuj tylko granicę HTTP.
- **»Should create«**: zawsze `await fixture.whenStable()` przed asercją, bo dopiero render tworzy dyrektywy z szablonu (brakujący provider, np. `DateAdapter`, wychodzi tylko wtedy). Żądania z `ngOnInit` obsłuż w kolejności, w jakiej powstają: flush → `whenStable` → następne `expectOne`. Builder ustawia `errorOnUnknownElements/Properties`, więc brakujący komponent lub binding `[x]` daje czerwony test. Nie złapie jednak dyrektywy użytej jako statyczny atrybut, np. `routerLink="/x"` bez importu `RouterLink`.
- **Behaviour (harnessy)**: pole znajdziesz po etykiecie, `MatFormFieldHarness.with({ floatingLabelText })`; etykieta to uchwyt użytkownika. Tekst wpisuje `MatInputHarness.setValue`, a datę `MatDatepickerInputHarness.setValue`, więc przechodzi przez adapter komponentu. Opcję wybiera `MatSelectHarness.clickOptions({ text })`. Element warunkowy sprawdzasz liczbą harnessów (0/1) w każdym stanie, nie sygnałem komponentu. Komunikat pola sprawdzasz przez `hasErrors()` po kliknięciu „Zapisz”, bez treści. Komunikat spoza Material sprawdzasz liczbą `[role="alert"]` i powiązaniem `aria-describedby`; przy `MatCheckbox` atrybut jest na wewnętrznym `input[type=checkbox]`. Wysłane dane sprawdzasz na granicy HTTP: `expectOne(...).request.body` porównane `toEqual` z całym ciałem z kontraktu API. Brak żądania to `expectNone({ method: 'POST', url })`. `httpTesting.verify()` dajesz w `afterEach`.
- **Reference tests**:
  - `src/app/subscriptions/subscription-form/subscription-form.spec.ts` — pomoc „wypełnij poprawny formularz” lokalna w specu; pola warunkowe w każdym stanie, ukryte pole nie blokuje zapisu, tabela wpisów w polskim formacie → ciało `POST` (wyrocznia: kontrakt i kalendarz; reszta przypadków parserów w testach jednostkowych).
  - `src/app/pages/register/register.spec.ts` — komunikaty nie-Materialowe: liczba alertów i `aria-describedby` po próbie zapisu.
  - `src/app/pages/subscriptions/subscriptions.spec.ts` — »should create« strony, która przy starcie robi dwa żądania jedno po drugim.
- **Run locally** (z `frontend-subtracker/`): jeden plik `npx ng test --include src/app/pages/register/register.spec.ts --watch=false`; obie strefy, jak w CI: `npm run test:ci`. Prefiks `TZ=...` przed `ng test` nie zmienia strefy na Windows, do tego służy `test:ci`.
- **Sabotage check**: jak w §6.1. Dla testu komponentu psuj szablon albo okablowanie: `@if (warunek)` → `@if (true)`, usunięty provider z `providers` komponentu, usunięte `enable()`. Spację twardą w danych zapisuj jako `\u00A0`; Edit i `sed` potrafią wstawić surowy znak.

### 6.3 Adding a backend unit test

- **Location**: obok testowanego pliku, `*.spec.ts` w `backend-subtracker/src/`; helpery z `src/shared/<obszar>/` zawsze z testem obok (`lessons.md`).
- **Run locally**: `cd backend-subtracker && npx vitest run <ścieżka>`.

### 6.4 Adding an API test for a new endpoint

- **Location**: `backend-subtracker/test/<obszar>.e2e-spec.ts` albo plik w katalogu obszaru, `test/<obszar>/<temat>.e2e-spec.ts`. Żądania wspólne dla plików obszaru trzymaj w pliku pomocniczym obszaru bez `.e2e-spec` (`test/subscriptions/subscriptions-e2e.ts`, `test/auth/auth-e2e.ts`). Pliki biegną po kolei (`fileParallelism: false`) na jednej bazie.
- **Start**: `const e2e = createE2eApp({ addressPrefix: 'e2e-<obszar>-<temat>-' })` z `test/support/e2e-app.ts`, `beforeAll(() => e2e.start())`, `afterAll(() => e2e.close())`. Prefiks jest własny dla pliku i nie może być początkiem prefiksu innego pliku, bo sprzątanie usuwa wszystko, co wisi na adresach `prefiks%`. Konto zakładasz przez `signIn()` (prawdziwe register → verify, mail przechwycony w `sent`), żądania wysyłasz przez `http()`, bazę czytasz przez `repository(Encja)`. Nie mockuj serwisów; zastąpiony jest tylko transport maili.
- **Dwa konta dla każdej trasy po id** (ryzyko #1): `const { owner, other } = await twoAccounts()`; `owner` tworzy zasób, potem `other` robi na jego id odczyt, zmianę i usunięcie. Każde dostaje 404 (albo 403, jeśli tak mówi kontrakt), a zasób `owner` jest potem nienaruszony: odczyt przez `owner` albo `repository(...)` daje te same pola. Lista `other` nie zawiera danych `owner`. Test na jednym koncie nie chroni przed IDOR.
- **Lista tras**: każdą nową trasę dopisz do `EXPECTED_ROUTES` w `test/routes.e2e-spec.ts` z dostępem `session` (albo `public` dla `@Public()`). Trasa z parametrem dostaje w `twoAccountTest` nazwę swojego testu dwóch kont. Bez wpisu ten plik jest czerwony; sprawdza też, że każda trasa `session` odpowiada 401 bez ciasteczka.
- **Reference tests**:
  - `test/subscriptions/account-isolation.e2e-spec.ts` — wzorzec dwóch kont; testy nowych tras po id dopisuj tutaj.
  - `test/routes.e2e-spec.ts` — strażnik listy tras i dostępu.
  - `test/subscriptions/subscriptions.e2e-spec.ts` — kolejność listy z polskimi literami (`breaks a tie on the date by the name in Polish order`); wzór dla nowego sortowania tekstu.
  - `test/auth/token-rules.e2e-spec.ts` — reguły tokenów i sesji z pomocnikami obszaru (`authRequests`).
- **Run locally** (z `backend-subtracker/`, potrzebny lokalny Postgres i `.env`): cały zestaw `npm run test:e2e`; jeden plik `npx vitest run --config ./vitest.config.e2e.ts test/subscriptions/account-isolation.e2e-spec.ts`. Lokalnie testy biegną na `subtracker-db-dev`.
- **Sabotage check**: jak w §6.1. Dla trasy po id usuń filtr po właścicielu w zapytaniu serwisu, uruchom plik z testem dwóch kont i zobacz czerwony test; dodaj trasę bez wpisu na liście i zobacz czerwony `routes.e2e-spec.ts`.
- **`C.UTF-8` tylko w CI**: lokalna baza (`Polish_Poland.1250`) sortuje po polsku nawet bez `COLLATE "pl-PL-x-icu"`, więc błąd sortowania lub unikalności nazw z polskimi literami (ryzyko #5) wychodzi tylko w jobie `backend-e2e`. Nowe sortowanie tekstu potrzebuje testu e2e z nazwami jak `Ślub`, `słoń`, `Zoo`; zielony przebieg lokalny tego nie dowodzi.

### 6.5 Adding a browser e2e test

- TBD — see §3 Phase 4: wzorzec przejścia przez zbudowany serwer SSR z sesją testową.

### 6.6 Per-rollout-phase notes

(Uzupełniane po każdej fazie: 2–3 linie o tym, czego faza nauczyła.)

- **§3 Phase 1 (2026-11-13)**: Pierwszy test od razu wykrył błąd: `parseDecimal(x, 0)` rzucał `SyntaxError` (kwantyfikator `{1,0}`). Uszkodzony zapis dnia odpada tylko na wschód od UTC, a uszkodzony odczyt tylko na zachód, dlatego zestaw biegnie w dwóch strefach, a test-strażnik odrzuca każdą inną. Logikę z formularza (budowa żądania) opłaca się wyjąć do czystej funkcji, zamiast testować ją przez komponent.
- **§3 Phase 2 (2026-11-13)**: Otwarte pytanie z researchu (czy błąd samodzielnej kontrolki `categoryName` pokazuje się po zapisie) rozstrzygnął test: pokazuje się, bo matcher widzi `submitted` rodzica, więc poprawka nie była potrzebna. Sabotaże potwierdziły, że tylko test komponentu pilnuje okablowania: `NativeDateAdapter` zamiast polskiego adaptera daje czerwone wszystkie wiersze z datą. Granica »should create«: brakujący komponent lub binding wychodzi (`errorOnUnknown*`), ale `routerLink` jako statyczny atrybut bez importu `RouterLink` przechodzi po cichu i link robi pełne przeładowanie strony.
- **§3 Phase 3 (2026-11-14)**: Pierwszy przebieg `backend-e2e` był zielony: obraz `postgres:16` ma ICU `pl-PL-x-icu`, a initdb przyjmuje `C.UTF-8`; przechwytywanie maili (`vi.waitFor`) jest stabilne na runnerze. Sabotaż `COLLATE` (usunięty z kolejności listy subskrypcji): lokalnie wszystkie e2e zielone, w CI czerwony dokładnie jeden test kolejności polskich nazw. Test jednostkowy też odpadł, ale tylko dlatego, że porównuje dosłowny `ORDER BY`; nowego sortowania bez `COLLATE` nie złapie, łapie je tylko e2e na `C.UTF-8`.

## 7. What We Deliberately Don't Test

- **Wygląd i piksele** (motyw, kolory, odstępy, snapshoty wizualne) — sprawdzane okiem, snapshoty dawałyby szum. Re-evaluate, jeśli regresja wizualna dotrze na produkcję niezauważona. (Source: Phase 2 interview Q5.)
- **Zachowanie stron statycznych** (`/privacy-policy`, `/unavailable`) — prerenderowane, bez logiki; mają tylko test »should create« (§3 Phase 2). Re-evaluate, jeśli dostaną dane lub logikę. (Source: Phase 2 interview Q5; refresh plan 2026-11-13.)
- **Dokładna treść komunikatów** — treść może ewoluować; test komponentu sprawdza, że komunikat jest widoczny przy błędzie, a nie jego tekst. Re-evaluate, jeśli treść stanie się wymaganiem (np. prawnym). (Source: refresh interview 2026-11-13 Q5.)
- **Położenie elementów względem siebie** (np. odstęp komunikatu od pola) — to wygląd, sprawdzany okiem. Re-evaluate jak wygląd i piksele. (Source: refresh interview 2026-11-13 Q2, Q5.)
- **Joby cyklu życia i przypomnienia o trialu** — jeszcze nie istnieją; testy wejdą razem z S-05/S-06 i `--refresh`. (Source: challenger, roadmap S-05/S-06.)
- **Limit wysyłki maili z publicznych tras** (rejestracja, prośba o link) — funkcji celowo nie ma w MVP, więc nie ma czego testować. Re-evaluate po MVP / przed publicznym startem, razem z dodaniem limitu (propozycja z archiwum: 1 link na 60 s per adres). (Source: archive 2026-11-03-magic-link-sign-in plan; research §3 Phase 3; decyzja użytkownika 2026-11-13.)
- **Dostarczalność maili (DKIM/DMARC)** — konfiguracja domeny i obserwowalność, nie test. (Source: challenger, infrastructure.md Risk Register.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-11-13
- Stack versions last verified: 2026-11-13
- AI-native tool references last verified: 2026-11-13

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (najbliżej: po S-05 — joby i przypomnienia),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
