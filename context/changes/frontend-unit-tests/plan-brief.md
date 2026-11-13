# Testy jednostkowe frontendu (F-03) — Plan Brief

> Full plan: `context/changes/frontend-unit-tests/plan.md`
> Research: `context/changes/frontend-unit-tests/research.md`

## What & Why

Faza 1 planu testów: frontend dostaje runner, bramkę w CI i testy, które dowodzą, że formularz nie
wysyła do API innej kwoty lub daty niż wpisana (#3), kwota miesięczna zgadza się z ręcznym wyliczeniem
(#4), a guardy podejmują właściwą decyzję na serwerze i w przeglądarce (#2). W S-02 błąd regexu kwoty
(każda kwota odrzucana) wyszedł dopiero w teście ręcznym.

## Starting Point

Frontend nie ma żadnego testu: brak celu `test` w `angular.json`, brak `vitest` i środowiska DOM, job
`frontend` w CI tylko buduje. Logika ryzyk siedzi w czystych funkcjach w `shared/` i `subscriptions/`,
w guardach `auth.guard.ts` oraz w prywatnej metodzie `SubscriptionForm.request()`.

## Desired End State

`npm test` i `npm run test:ci` (dwie strefy czasowe) działają lokalnie i w CI; czerwony test blokuje PR.
Każdy plik testów ma wyrocznię z wymagań i przeszedł kontrolę celowego uszkodzenia zapisaną w
`sabotage-log.md`. `test-plan.md` §6.1 mówi, jak dodać kolejny test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Runner | Vitest ^4.1 przez `@angular/build:unit-test` | Builder Angulara 22 ma go wbudowanego, backend używa tej samej linii | Research |
| Środowisko DOM | jsdom | Domyślny wybór buildera, wystarcza bez przeglądarki | Plan |
| Strefa czasowa | Dwa przebiegi: `Europe/Warsaw` i `America/New_York`, skrypt Node + test-strażnik | Błąd przesunięcia doby widać tylko poza UTC, w przeciwnych kierunkach | Research / Plan |
| Zaokrąglenie kwoty miesięcznej | Grosze / 12, do grosza per subskrypcja, połówka w górę | Decyzja produktowa zapisana w `test-plan.md` §2 | Test plan |
| Ciało żądania z formularza | Wydzielić czystą funkcję `toCreateSubscriptionRequest` | Testuje dokładnie to, co idzie do API, bez testu komponentu | Plan |
| Kontrola celowego uszkodzenia | Ręczna, zapisana w `sabotage-log.md` | Tania, bez nowego narzędzia; dowodzi, że wyrocznia gryzie | Plan |
| Błąd wykryty testem | Naprawiany w tej fazie (duży — stop i pytanie) | Bramka CI od początku zielona i uczciwa | Plan |
| Interceptory auth | W zakresie (oba) | Ten sam setup co guardy, druga połowa „wylogowany widzi stronę zalogowanego” | Plan |
| `skipTests` w `angular.json` | Bez zmian | Wygenerowane specy komponentów nie dają sygnału | Plan |

## Scope

**In scope:**
- Runner, skrypt dwóch stref, krok `npm run test:ci` w jobie `frontend`
- Testy: `decimal`, `subscription-validators`, `date-only`, `pl-date-adapter`, `not-before-date`,
  `trimmed-required`, `subscription-request` (nowy plik), `subscription-amounts`, `auth.guard`,
  oba interceptory
- `test-plan.md` §6.1, §4, §5, §6.5, status §3

**Out of scope:**
- Testy komponentów, render mode i nagłówki cache SSR (faza 3 planu testów)
- Stryker i próg pokrycia, hooki, MCP, e2e
- Sumy kwot (S-04)

## Architecture / Approach

Czyste funkcje testowane tabelami `it.each` bez TestBed (najtańsza warstwa). TestBed tylko tam, gdzie
jest DI: `PlDateAdapter`, guardy (`PLATFORM_ID`, `REQUEST`) i interceptory, z `HttpTestingController`
jako jedyną makietą (granica HTTP). Czas guardów sterowany fake timerami Vitest, czas helperów —
wstrzykiwanym `today`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner, dwie strefy, bramka CI | `ng test`, `test:ci`, krok w CI, test kwot | Builder może nie przekazać `TZ` do workerów — test-strażnik to wykrywa |
| 2. Kwoty, daty, kwota miesięczna (#3, #4) | Testy helperów + wydzielona `subscription-request.ts` | Refaktoryzacja formularza nie może zmienić zachowania |
| 3. Guardy i interceptory (#2) | Macierz 2 platformy × 4 stany sesji, timeouty, ciasteczko | Fake timery z RxJS `timeout` w trybie zoneless |
| 4. Cookbook i zamknięcie | §6.1 i pozostałe sekcje `test-plan.md` | — |

**Prerequisites:** Node 24 (`fnm`), `npm install` w `frontend-subtracker/`; backend tylko do ręcznego
sprawdzenia formularza w fazie 2.
**Estimated effort:** ~2–3 sesje w 4 fazach.

## Open Risks & Assumptions

- Nie sprawdzono, czy `ng test` przekazuje `TZ` do workerów Vitest i czy `TZ` z IANA działa w Node na
  Windowsie — faza 1 to weryfikuje testem-strażnikiem, zanim powstaną testy dat.
- Wersja buildera może wymagać `buildTarget` w celu `test` — do ustalenia przy pierwszym `ng test`.
- Testy mogą wykazać błędy w helperach; małe poprawki wchodzą do tej zmiany.

## Success Criteria (Summary)

- PR z regresją w parsowaniu kwoty, dacie, kwocie miesięcznej albo decyzji guarda jest czerwony w CI.
- Testy dat odpadają po wprowadzeniu znanych błędów strefowych w każdej z dwóch stref.
- Nowy test helpera da się dodać, czytając tylko §6.1 planu testów.
