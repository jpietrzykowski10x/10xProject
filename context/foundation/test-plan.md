# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-11-13

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
Ryzyka są scenariuszami w kategoriach użytkownika i biznesu, nie nazwami testów.
Kolumna Source cytuje *dowód, który podniósł ryzyko* — nigdy konkretny plik jako
„miejsce awarii” (to zadanie researchu, §1 zasada 3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Użytkownik odczytuje, zmienia lub usuwa subskrypcje albo kategorie innego konta — endpoint sprawdza zalogowanie, a nie własność zasobu (IDOR) | High | High | PRD Guardrails i Access Control; interview Q1; roadmap S-03 i S-10 (nowe trasy po id), S-09 (wyjątek od izolacji dla admina) |
| 2 | Guard wpuszcza wylogowanego na stronę zalogowanego albo więzi zalogowanego na stronie publicznej; serwer (SSR) i przeglądarka podejmują różne decyzje; HTML zalogowanego trafia do cache | High | High | interview Q3; archive 2026-11-10-ui-foundation (przeglądy: guard przy prerenderze, przekazywanie ciasteczka); hot-spot dir `frontend-subtracker/src/app/auth` (11 zmian plików / 30 dni) |
| 3 | Formularz odrzuca poprawną kwotę lub datę albo wysyła do API inną wartość niż wpisana (separator dziesiętny, `d.m.rrrr`, nieistniejące daty, przesunięcie strefy) | High | High | interview Q2 (regex kwoty odrzucał każdą wartość); archive 2026-11-11-first-subscription-in-list; hot-spot dirs `frontend-subtracker/src/app/shared` (12), `frontend-subtracker/src/app/pages` (67) |
| 4 | Kwota miesięczna lub roczna różni się od ręcznego wyliczenia (roczne ↔ miesięczne, zaokrąglenia, wliczane statusy) | High | Medium | PRD Success Criteria (100% zgodności sum); roadmap S-04 (Risk, Unknowns), S-08 |
| 5 | Na produkcji (`C.UTF-8`) sortowanie lub unikalność nazw kategorii z polskimi literami działa inaczej niż lokalnie — testy przechodzą, produkcja ma duplikaty lub złą kolejność | Medium | High | interview Q2; archive 2026-11-11-first-subscription-in-list (locale bazy, klucz nazwy); CLAUDE.md Tripwires (lokalne e2e tego nie złapią) |
| 6 | Nadużycie logowania: magic link działa ponownie lub po terminie, wygasła sesja daje dostęp, publiczne trasy pozwalają zalać skrzynkę mailami | High | Low | PRD US-01 Acceptance Criteria; archive 2026-11-03-magic-link-sign-in (przeglądy: liczba wysyłek, współbieżne verify); interview Q4 (backend dobrze pokryty) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Konto B dostaje 404/403 przy każdym odczycie i zapisie zasobu konta A; lista B nie zawiera danych A | „zalogowany = uprawniony”; „test listy wystarcza, choć dochodzą trasy po id” | wszystkie trasy przyjmujące id zasobu; jak zapytania zawężają po właścicielu; istniejące e2e na dwóch kontach | integracja API (e2e backendu na prawdziwej bazie) | test na jednym koncie (tylko happy path) |
| #2 | Dla {serwer, przeglądarka} × {brak ciasteczka, ważna sesja, wygasła sesja, API nie odpowiada} guard daje oczekiwane przekierowanie; strona zalogowanego nie jest cache'owana | „działa w `ng serve`, więc działa w SSR” | render mode każdej trasy; przekazywanie ciasteczka do API; limit czasu; nagłówki cache | unit guardów + e2e na zbudowanym serwerze SSR dla 2–3 przejść | mockowanie wnętrza guarda zamiast granicy HTTP |
| #3 | Tabela wejść w polskim formacie (np. `12,99`, `1 299,00`, `29.02.2027`, `31.02.2027`) daje oczekiwane wartości wysłane do API albo jawne odrzucenie | „regex przepuszcza przykład z planu, więc przepuszcza wszystkie” | helpery parsowania kwot i dat; kontrakt API dla kwoty i daty | unit | oczekiwana wartość przepisana z implementacji (problem wyroczni) |
| #4 | Sumy dla zestawu z ręcznie policzonym wynikiem (miesięcznie i rocznie, w groszach) zgadzają się co do grosza | „suma na liczbach zmiennoprzecinkowych jest dokładna” | gdzie liczona jest suma (front czy API); które statusy się wliczają | unit z wyrocznią policzoną ręcznie | skopiowany wzór z kodu produkcyjnego |
| #5 | W bazie `C.UTF-8` (jak produkcja) nazwy różniące się wielkością polskich liter są duplikatem, a sortowanie jest polskie | „lokalna baza zachowuje się jak produkcyjna” | locale bazy w CI; collation w zapytaniach; klucz nazwy kategorii | e2e backendu na Postgresie `C.UTF-8` w CI | test uruchamiany tylko na lokalnym `Polish_Poland.1250` |
| #6 | Drugie użycie linku i link po terminie są odrzucane; wygasła sesja dostaje 401 | „istniejące testy chodzą w CI” (dziś e2e nie chodzą) | obecne pokrycie e2e auth; co faktycznie uruchamia CI | e2e backendu (istnieją) + bramka w CI | dopisywanie testów, które już istnieją |

## 3. Phased Rollout

Każdy wiersz to osobna faza wdrożenia, która otwiera własny folder zmiany
przez `/10x-new`. Status przesuwa się w prawo zgodnie ze słownikiem poniżej;
orkiestrator aktualizuje go, gdy artefakty pojawiają się na dysku.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Frontend unit tests (roadmap F-03) | Runner i bramka CI na froncie; dowód, że parsowanie kwot i dat, przeliczenie na miesiąc i decyzje guardów nie przepuszczają złych wartości | #3, #2, #4 | unit | change opened | context/changes/frontend-unit-tests/ |
| 2 | Account isolation and backend e2e in CI | e2e backendu w CI na Postgresie `C.UTF-8`; dowód, że żadna trasa po id nie zwraca ani nie zmienia cudzych danych | #1, #5, #6 | integration (API e2e), CI gate | not started | — |
| 3 | Critical browser paths | 2–3 przejścia na zbudowanym SSR: przekierowania guardów, brak cache stron zalogowanego, dodana subskrypcja widoczna na liście | #2, #1 | e2e | not started | — |
| 4 | Agent-loop hooks | lint, typecheck i unit uruchamiane po edycji i na koniec tury agenta | cross-cutting | post-edit hook | not started | — |

## 4. Stack

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit (backend) | Vitest | ^4.1.2 | `backend-subtracker/src/**/*.spec.ts`, 20 plików; w CI |
| integration / API e2e (backend) | Vitest + Supertest | ^4.1.2 / ^7.0.0 | `backend-subtracker/test/`, 3 pliki na prawdziwym Postgresie; NIE w CI — see Phase 2 |
| unit (frontend) | none yet — see Phase 1 | — | Angular 22 (`@angular/build` ^22.2.0); wybór runnera w researchu fazy 1, preferencja Vitest |
| e2e (przeglądarka) | none yet — see Phase 3 | — | kandydat: Playwright (lekcja m3l4) |
| accessibility | none | — | poza zakresem rolloutu; kontrole ręczne przy `/10x-ui` |
| (optional) AI-native | post-edit hook w Claude Code — checked: 2026-11-13 | n/a | When NOT to use: jako zamiennik bramki CI albo z testami trwającymi dłużej niż kilka sekund |

Profil bazy testów: `sparse` — backend ma Vitest (20 unit, 3 e2e), frontend nie ma runnera ani testów.

**Stack grounding tools (current session):**
- Docs: none — Context7 ani inny MCP dokumentacji nie jest dostępny w tej sesji; wersje z `package.json`; checked: 2026-11-13
- Search: WebSearch (wbudowany) — nieużyty przy pisaniu planu; do potwierdzenia runnera Angulara 22 w researchu fazy 1; checked: 2026-11-13
- Runtime/browser: Claude in Chrome — not used; ewentualnie do eksploracji w fazie 3; checked: 2026-11-13
- Provider/platform: GitHub (`gh`, token tylko do odczytu) — odczyt wyników CI; checked: 2026-11-13

## 5. Quality Gates

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint (backend, oxlint type-aware) | local + CI | required | dryf typów i składni w API |
| build frontendu (typecheck AOT) | CI | required | błędy typów i szablonów frontu |
| unit backend | local + CI | required | regresje logiki API |
| unit frontend | local + CI | required after §3 Phase 1 | regresje parsowania, przeliczeń i guardów |
| API e2e backendu na Postgresie `C.UTF-8` | CI on PR | required after §3 Phase 2 | wyciek między kontami, różnice locale, regresje auth |
| e2e w przeglądarce (krytyczne ścieżki) | CI on PR | required after §3 Phase 3 | zepsute przekierowania SSR i główny przepływ |
| post-edit hook | local (agent loop) | recommended after §3 Phase 4 | regresje w chwili edycji |

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Każda podsekcja jest uzupełniana, gdy
odpowiednia faza wdrożenia zostanie dostarczona; wcześniej brzmi „TBD — see §3 Phase <N>.”

### 6.1 Adding a frontend unit test

- TBD — see §3 Phase 1: wzorzec tabeli wejść z niezależną wyrocznią dla parsowania kwot i dat oraz decyzji guardów.

### 6.2 Adding a backend unit test

- **Location**: obok testowanego pliku, `*.spec.ts` w `backend-subtracker/src/`; helpery z `src/shared/<obszar>/` zawsze z testem obok (`lessons.md`).
- **Run locally**: `cd backend-subtracker && npx vitest run <ścieżka>`.

### 6.3 Adding an API test for a new endpoint

- TBD — see §3 Phase 2: wzorzec dwóch kont (właściciel i obcy) dla każdej trasy po id, uruchamiany na bazie `C.UTF-8`.

### 6.4 Adding a browser e2e test

- TBD — see §3 Phase 3: wzorzec przejścia przez zbudowany serwer SSR z sesją testową.

### 6.5 Per-rollout-phase notes

(Uzupełniane po każdej fazie: 2–3 linie o tym, czego faza nauczyła.)

## 7. What We Deliberately Don't Test

- **Wygląd i piksele** (motyw, kolory, odstępy, snapshoty wizualne) — sprawdzane okiem, snapshoty dawałyby szum. Re-evaluate, jeśli regresja wizualna dotrze na produkcję niezauważona. (Source: Phase 2 interview Q5.)
- **Strony statyczne** (`/privacy-policy`, `/unavailable`) — prerenderowane, bez logiki. Re-evaluate, jeśli dostaną dane lub logikę. (Source: Phase 2 interview Q5.)
- **Joby cyklu życia i przypomnienia o trialu** — jeszcze nie istnieją; testy wejdą razem z S-05/S-06 i `--refresh`. (Source: challenger, roadmap S-05/S-06.)
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
