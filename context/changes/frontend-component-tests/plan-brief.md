# Testy komponentów frontendu — Plan Brief

> Full plan: `context/changes/frontend-component-tests/plan.md`
> Research: `context/changes/frontend-component-tests/research.md`

## What & Why

Faza 2 planu testów: testy komponentów dla ryzyka #7 (pole końca trialu, pole własnej kategorii i komunikaty
walidacji pojawiają się dokładnie wtedy, kiedy powinny; każdy komponent się renderuje) oraz #3 (tekst wpisany
w prawdziwe pole trafia do `POST /subscriptions` zgodnie z kontraktem API). Testy fazy 1 sprawdzają klocki
osobno, ale nie to, że formularz ma je podpięte — bez polskiego adaptera dat `05.01.2027` staje się 1 maja.

## Starting Point

Runner Vitest + jsdom i bramka `test:ci` w dwóch strefach działają od fazy 1; 11 testów jednostkowych, żadnego
przy komponencie, `skipTests: true` w schemacie komponentu. Formularz subskrypcji sam dostarcza adapter dat;
pola warunkowe mają osobno `@if` (widoczność) i `enable/disable` (walidacja).

## Desired End State

12 komponentów ma spec. Spec formularza subskrypcji sprawdza każdy stan warunkowy, błąd pola po próbie zapisu,
brak blokady przez ukryte pole oraz tabelę wpisów → ciało żądania. `register` ma test komunikatów przy
checkboxach. Nowy komponent ze schematu dostaje spec, który od razu działa w polskim locale. §6.2 planu
testów opisuje wzorzec.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Warstwa | Test komponentu TestBed (zoneless) + jsdom + harnessy Material | Najtańsza warstwa, która widzi okablowanie szablonu, providerów i żądania | Research |
| Makieta | Tylko granica HTTP (`HttpTestingController`), prawdziwy serwis | Mock serwisu lub wnętrza formularza ukryłby właśnie te awarie | Research / §2 |
| Wyrocznia | Kontrakt API i kalendarz, całe ciało `toEqual` | Wartości z kodu powtórzyłyby jego błąd | Research / §2 #3 |
| Przykład daty | `29.02.2027` odrzucany, `29.02.2028` przyjmowany | 2027 nie jest przestępny | Research |
| Komunikaty | `MatFormFieldHarness.hasErrors()`, `role="alert"` liczone; bez treści | §7: treść może się zmieniać | §7 |
| Wspólne providery | `src/test-providers.ts` przez `providersFile` (locale pl-PL, animacje wyłączone) | Spec ze schematu działa jak produkcja bez pamiętania o tym | Plan |
| HTTP i router | Per spec, tylko gdzie komponent ich potrzebuje | To zależności konkretnych komponentów, nie środowiska | Plan |
| `register` | Jeden test zachowania komunikatów przy checkboxach | Własny, nie-Materialowy mechanizm na stronie z hot-spotu | Plan |
| Błąd `categoryName` | Pierwszy test; czerwony = błąd #7 naprawiany w tej fazie | Kontrolka poza grupą — zachowanie niepotwierdzone uruchomieniem | Research |

## Scope

**In scope:**
- `providersFile`, `skipTests: false` dla schematu komponentu
- Spec `SubscriptionForm`: 9 zachowań #7 i tabela 9 wpisów #3
- »Should create« (z renderowaniem) dla 11 pozostałych komponentów; test zachowania `register`
- §6.2, §6.6, §4 planu testów

**Out of scope:**
- Treść komunikatów, układ, snapshoty; wariant telefonu
- Testy zachowania `sign-in`, `verify-link`, `app-shell`, strony `/subscriptions`
- Powtórka tabel parserów z fazy 1; zmiany CI i hooki

## Architecture / Approach

Każdy spec: TestBed + providery globalne z `providersFile`, w specu `provideHttpClient()` +
`provideHttpClientTesting()` i `provideRouter([])` według potrzeb. Harness wpisuje tekst, klika „Zapisz”,
test sprawdza `expectOne`/`expectNone` na `POST /subscriptions` i `hasErrors()` pola. `test:ci` puszcza
wszystko w `Europe/Warsaw` i `America/New_York`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Środowisko + pola warunkowe (#7) | providersFile, schemat, spec stanów i komunikatów formularza | Błąd `categoryName` po zapisie może nie działać (realny bug) |
| 2. Tekst → `POST` (#3) | Tabela wpisów przez prawdziwe pola, dwie strefy | Harness datepickera w jsdom — sprawdzane pierwszym wierszem |
| 3. »Should create« + `register` | 11 specs tworzenia, test komunikatów checkboxów | `Subscriptions` robi dwa żądania przy starcie |
| 4. Plan testów | §6.2 przepis, §6.6 notatka, §4 wiersz | — |

**Prerequisites:** Node 24, `npm ci` w `frontend-subtracker/`; faza 1 zarchiwizowana.
**Estimated effort:** ~2–3 sesje w 4 fazach.

## Open Risks & Assumptions

- Animacje wyłączone przez `MATERIAL_ANIMATIONS` mają wystarczyć do otwierania `mat-select` w jsdom.

## Success Criteria (Summary)

- Usunięcie adaptera dat, `@if` pola warunkowego lub `enable()` daje czerwony test w CI.
- Nowy komponent ze schematu ma działający spec bez ręcznej konfiguracji.
- `npm run test:ci` zielony w obu strefach.
