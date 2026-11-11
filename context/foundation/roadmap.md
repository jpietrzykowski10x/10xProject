---
project: SubTracker
version: 1
status: draft
created: 2026-10-16
updated: 2026-11-11
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: mvp-subscription-control
milestone_seq: 1
milestone_status: open
---

# Roadmap: SubTracker

> Derived from `context/foundation/prd.md` (v1) + `tech-stack.md`, `infrastructure.md`, `context/deployment/deploy-plan.md` + auto-researched codebase baseline.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: MVP — kontrola subskrypcji i budżetu** — Status: open

- **Intent:** Zalogowany użytkownik prowadzi pełną listę swoich subskrypcji, widzi ich realny koszt miesięczny i roczny, dostaje ostrzeżenia o duplikatach i przekroczeniu budżetu oraz przypomnienie przed końcem triala; administrator może obsłużyć konto, gdy zawiodą standardowe ścieżki. Wszystkie FR konieczne (must-have) z PRD działają na produkcji.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001, FR-002, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-013, FR-014, FR-018 (wszystkie must-have); US-01. Nice-to-have (FR-003, FR-012, FR-015, FR-016, FR-017) są poza tym kamieniem milowym — patrz `## Parked`.

## Vision recap

Osoby korzystające z wielu subskrypcji i wielu kart tracą kontrolę nad cyklicznymi zobowiązaniami: przegapiają koniec okresów próbnych, płacą za nakładające się usługi i nie wiedzą, ile realnie wydają miesięcznie. SubTracker zbiera te zobowiązania w jednym miejscu, przelicza je do wspólnego mianownika (miesiąc/rok) i sam pilnuje duplikatów, budżetu i końców triali — zamiast wymagać regularnej ręcznej pracy jak arkusz czy kategoryzacja w banku.

## North star

**S-02: Użytkownik dodaje pierwszą subskrypcję i widzi ją na liście** — to dokładnie pierwsze kryterium sukcesu z PRD (od wejścia na stronę do pierwszej subskrypcji na liście w < 3 min); przy celu `speed` dostarczenie go jak najwcześniej potwierdza, że cały przepływ logowanie → zapis → lista działa na produkcji, zanim dojdą alerty i automatyka.

> Gwiazda przewodnia (north star) oznacza tu najmniejszy przepływ end-to-end, którego działanie dowodzi, że produkt spełnia swoją podstawową obietnicę — dlatego stoi tak wcześnie, jak pozwalają jego wymagania wstępne: wszystko inne ma sens tylko wtedy, gdy to działa.

## At a glance

| ID   | Change ID                         | Outcome (user can …)                                                              | Prerequisites | PRD refs                      | Status   |
| ---- | --------------------------------- | --------------------------------------------------------------------------------- | ------------- | ----------------------------- | -------- |
| F-01 | production-database-wiring        | (foundation) API ma produkcyjną bazę z migracjami w deployu; frontend woła API    | —             | Access Control, Guardrails    | done |
| S-01 | magic-link-sign-in                | użytkownik rejestruje się i loguje magic linkiem i widzi swoją (pustą) listę subskrypcji | F-01          | FR-001, US-01                 | done |
| F-02 | ui-foundation                     | (foundation) ekrany S-01 mają docelowy wygląd i układ; gotowy motyw dla kolejnych slice'ów | S-01          | Guardrails                    | done        |
| S-02 | first-subscription-in-list        | użytkownik dodaje subskrypcję ze wszystkimi szczegółami i widzi ją na liście      | S-01, F-02    | FR-004, FR-007, FR-018, US-01 | in-progress |
| F-03 | frontend-unit-tests               | (foundation) frontend ma test runner, testy jednostkowe w CI i pierwsze testy helperów `shared/` | S-02          | Guardrails                    | proposed |
| S-03 | edit-and-delete-subscription      | użytkownik poprawia lub usuwa błędnie dodaną subskrypcję                          | S-02, F-03    | FR-005, FR-006                | proposed |
| S-04 | dashboard-cost-totals             | użytkownik widzi sumę miesięczną i roczną z podziałem na kategorie                | S-02          | FR-008, US-01                 | proposed |
| S-05 | subscription-lifecycle            | subskrypcja sama przechodzi trial → active i cancelled_pending → cancelled        | S-02          | FR-013                        | proposed |
| S-06 | trial-end-reminder                | użytkownik dostaje e-mail 7 dni przed końcem okresu próbnego                      | S-05          | FR-014                        | proposed |
| S-07 | category-duplicate-warning        | użytkownik widzi ostrzeżenie, gdy kategoria przekroczy jego próg subskrypcji      | S-04          | FR-009, FR-005                | proposed |
| S-08 | budget-limits-and-alerts          | użytkownik ustawia limity budżetu i widzi alert przy 80% / 100%                   | S-04          | FR-010, FR-011, FR-005        | proposed |
| S-09 | admin-account-management          | administrator odblokowuje konto lub resetuje dostęp i wgląda w dane użytkownika   | S-02          | FR-002                        | proposed |
| S-10 | account-deletion                  | użytkownik sam usuwa swoje konto razem ze wszystkimi danymi                       | S-02          | NFR (usunięcie danych w 30 dni) | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                                   | Note                                                                                   |
| ------ | ---------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| A      | Rdzeń: konto i lista   | `F-01` → `S-01` → `F-02` → `S-02` → `F-03` → `S-03` | Ścieżka krytyczna do gwiazdy przewodniej; wszystko inne startuje od `S-02`. `F-03` przed kolejną zmianą frontendu. |
| B      | Koszt i alerty         | `S-04` → `S-07`, `S-08`                 | Dołącza do Stream A po `S-02`; `S-07` i `S-08` mogą iść równolegle po `S-04`.          |
| C      | Cykl życia i e-mail    | `S-05` → `S-06`                         | Dołącza do Stream A po `S-02`; najbardziej ryzykowna technicznie gałąź — nie zwlekać.  |
| D      | Administracja i konto  | `S-09`, `S-10`                          | Dołącza do Stream A po `S-02`; niezależna od B i C. `S-10` dzieli z `S-09` unieważnianie sesji i tokenów. |

## Baseline

What's already in place in the codebase as of `2026-10-16` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — szkielet Angular 22 z SSR, routing pusty (`frontend-subtracker/src/app/app.routes.ts`), brak widoków domenowych.
- **Backend / API:** partial — NestJS 12 „Hello World” (`backend-subtracker/src/app.controller.ts`), brak modułów domenowych i CORS.
- **Data:** absent — brak sterownika bazy i ORM w zależnościach; baza na MyDevil tylko zaplanowana (`tech-stack.md`).
- **Auth:** absent — brak magic linku, sesji, ochrony tras i roli administratora.
- **Deploy / infra:** present — GitHub Actions (`.github/workflows/deploy-*.yml`) + `deploy/mydevil/*.sh`; obie aplikacje działają na produkcji, rollback i restart przetestowane (`context/deployment/deploy-plan.md`).
- **Observability:** absent — tylko logi procesów (`deploy/mydevil/start-app.sh`), brak alertów i monitoringu.

## Foundations

### F-01: Produkcyjna baza i połączenie frontend → API

- **Outcome:** (foundation) API łączy się z produkcyjną bazą danych, deploy robi kopię bazy i uruchamia migracje przed przełączeniem wersji, a frontend z innej subdomeny może wywołać API (pierwsze wywołanie potwierdzone na produkcji). Bez tabel domenowych — te dochodzą w slice'ach.
- **Change ID:** production-database-wiring
- **PRD refs:** Access Control, Guardrails
- **Unlocks:** S-01 (konto użytkownika i tokeny logowania wymagają trwałego zapisu), S-02; ścieżka weryfikacji „migracja przechodzi w deployu i da się ją bezpiecznie zatrzymać” (zarezerwowany krok w skrypcie deployu z `deploy-plan.md`).
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Jakie są limity połączeń współdzielonej bazy na koncie MyDevil (nieudokumentowane wg `infrastructure.md`)? — Owner: user. Block: no.
- **Risk:** Stoi pierwsza, bo bez trwałego zapisu i migracji w deployu nie da się zweryfikować na produkcji ani logowania, ani gwiazdy przewodniej; zakres celowo minimalny (połączenie + migracje + CORS), żeby nie budować warstwy danych na zapas.
- **Status:** done

### F-02: Fundament interfejsu

- **Outcome:** (foundation) istniejące ekrany S-01 mają docelowy wygląd i układ na desktopie i telefonie (Angular Material z motywem projektu), pod `/` jest strona startowa renderowana na serwerze, a kolejne slice'y korzystają z gotowego motywu, formularzy, przycisków i szkieletu strony.
- **Change ID:** ui-foundation
- **PRD refs:** Guardrails
- **Unlocks:** S-02 (formularz dodawania i lista powstają od razu w docelowym stylu, bez przeróbek).
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Stoi przed S-02, żeby nie przerabiać wyglądu w każdym kolejnym slice'ie; ryzyko w rozroście zakresu, więc zmiana obejmuje tylko istniejące ekrany, szkielet i stronę startową, a sumy i alerty dochodzą w swoich slice'ach.
- **Status:** done

### F-03: Testy jednostkowe frontendu

- **Outcome:** (foundation) `frontend-subtracker` ma działający test runner (`ng test` / `npm test`), testy jednostkowe uruchamiane w CI (`ci.yml`, job `frontend`) i pierwsze testy czystych helperów: `shared/decimal.ts` (`parseDecimal`), `shared/pl-date-adapter.ts` (`parse`, w tym 31.02 i `d.m.rrrr`), `shared/date-only.ts` (`daysFromToday`, `toDateOnly` bez przesunięcia strefy), `subscriptions/subscription-amounts.ts` (`monthlyAmount`) i walidatory formularza subskrypcji. Kontrola celowego uszkodzenia dla każdego testu.
- **Change ID:** frontend-unit-tests
- **PRD refs:** Guardrails
- **Unlocks:** S-03 i kolejne zmiany frontendu z bramką testów zamiast samych testów ręcznych; reguła z `lessons.md` („helper w `shared/` z testem obok”) da się spełnić także na froncie.
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05, S-09 (backend)
- **Blockers:** —
- **Unknowns:**
  - Runner: wbudowany builder Angulara 22 (`@angular/build:unit-test` z Vitest) czy Karma/Jest — rozstrzygnąć w `/10x-research`; preferencja: Vitest, jak w backendzie. — Owner: agent. Block: no.
  - Czy moduł 3 kursu (strategia testów, bramki jakości) narzuca układ testów — sprawdzić przed `/10x-plan`. — Owner: user. Block: no.
- **Risk:** Frontend powstał z `--skip-tests`; w S-02 błąd w wyrażeniu regularnym kwoty (każda kwota odrzucana) wyszedł dopiero w teście ręcznym. Zakres celowo mały (runner, CI, helpery), bez testów komponentów i e2e przeglądarki.
- **Status:** proposed

## Slices

### S-01: Logowanie magic linkiem

- **Outcome:** użytkownik rejestruje się e-mailem (z oświadczeniem o pełnoletności i akceptacją polityki prywatności) albo przy kolejnym wejściu wpisuje e-mail, dostaje jednorazowy, ograniczony czasowo link, loguje się nim i widzi swoją (na razie pustą) listę subskrypcji; inni użytkownicy nie mają do niej dostępu.
- **Change ID:** magic-link-sign-in
- **PRD refs:** FR-001, US-01
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy e-maile z poczty MyDevil docierają do Gmaila/Outlooka (SPF/DKIM/DMARC domeny, reputacja współdzielonego IP)? Sprawdzone na produkcji 2026-11-09: maile dochodzą na Gmaila i Outlooka, SPF PASS, DKIM brak, DMARC FAIL. Ryzyko przyjęte na MVP; DKIM i DMARC do naprawy przed publicznym startem. — Owner: user. Block: no.
  - Rozstrzygnięte: jak długo ważny jest link i jak długo trwa sesja? Link 15 minut, sesja stałe 30 dni bez przedłużania. — Owner: user. Block: no.
- **Risk:** Pierwszy slice użytkowy, bo wszystko inne wymaga zalogowanego użytkownika; ryzyko w dostarczalności e-maila i w ciasteczku sesji między subdomenami — widoki dla zalogowanego nie mogą być prerenderowane statycznie.
- **Status:** done

### S-02: Pierwsza subskrypcja na liście

- **Outcome:** użytkownik dodaje subskrypcję (nazwa, kategoria z predefiniowanej listy lub własna, kwota w PLN, cykl miesięczny/roczny, forma płatności z zamkniętej listy, status, data końca triala, data następnego rozliczenia) i natychmiast widzi ją w tabeli wszystkich swoich subskrypcji.
- **Change ID:** first-subscription-in-list
- **PRD refs:** FR-004, FR-007, FR-018, US-01
- **Prerequisites:** S-01, F-02
- **Parallel with:** —
- **Blockers:** — (ochrona CSRF zrobiona w `csrf-protection`, na produkcji od 2026-11-11).
- **Unknowns:**
  - Jaka jest predefiniowana lista kategorii na start? — Owner: user. Block: no.
- **Risk:** Gwiazda przewodnia — stoi zaraz po logowaniu; ryzyko w czasie przejścia (< 3 min wg kryterium sukcesu), więc formularz musi być krótki mimo wielu pól.
- **Status:** in-progress

### S-03: Edycja i usuwanie subskrypcji

- **Outcome:** użytkownik poprawia dane istniejącej subskrypcji albo trwale usuwa błędnie dodaną — odrębnie od anulowania usługi w cyklu życia.
- **Change ID:** edit-and-delete-subscription
- **PRD refs:** FR-005, FR-006
- **Prerequisites:** S-02, F-03
- **Parallel with:** S-04, S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wcześnie, bo bez edycji pomyłki z S-02 blokują testowanie reszty; wymóg ponownego przeliczenia z FR-005 dociera do budżetu i duplikatów dopiero w S-07/S-08 — te slice'y muszą przeliczać po edycji.
- **Status:** proposed

### S-04: Sumy kosztów na dashboardzie

- **Outcome:** użytkownik widzi na dashboardzie łączny koszt subskrypcji miesięcznie i rocznie, z podziałem na kategorie, zgodny z ręcznym wyliczeniem.
- **Change ID:** dashboard-cost-totals
- **PRD refs:** FR-008, US-01
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-05, S-06, S-09
- **Blockers:** —
- **Unknowns:**
  - Czy do sum wliczają się subskrypcje w trialu i w cancelled_pending? — Owner: user. Block: no.
- **Ustalenia z S-02:** `amount` to kwota za cykl (`monthly` / `yearly`), w API string `"43.00"`; lista zwraca także subskrypcje anulowane (`cancelled`), więc sumy muszą je odfiltrować świadomie. Frontend ma już `monthlyAmount` (dzielenie rocznej przez 12 w groszach, `Math.round`) dla dopisku na liście — sumy po stronie API muszą liczyć tak samo (w groszach), inaczej lista i dashboard pokażą różne kwoty.
- **Risk:** Drugie kryterium sukcesu (100% zgodności sum) — błąd przeliczenia roczne ↔ miesięczne propaguje się do budżetu (S-08), więc S-04 stoi przed alertami.
- **Status:** proposed

### S-05: Automatyczny cykl życia subskrypcji

- **Outcome:** użytkownik anuluje subskrypcję (trafia do cancelled_pending), a system sam przenosi subskrypcje trial → active po dacie końca triala i cancelled_pending → cancelled po dacie następnego rozliczenia.
- **Change ID:** subscription-lifecycle
- **PRD refs:** FR-013
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Które przejścia wyzwala użytkownik, a które tylko system (np. czy użytkownik może ręcznie wrócić z cancelled_pending do active)? — Owner: user. Block: no.
  - W jakiej strefie czasowej liczone są daty przejść (zmiana czasu, `infrastructure.md`)? — Owner: user. Block: no.
- **Risk:** Najbardziej ryzykowna technicznie gałąź (zadania cykliczne na stale działającym procesie) — sekwencjonowana zaraz po gwieździe przewodniej, żeby przy ryzyku `time` nie zostać na koniec.
- **Status:** proposed

### S-06: Przypomnienie przed końcem triala

- **Outcome:** użytkownik z subskrypcją w trialu dostaje e-mail 7 dni przed końcem okresu próbnego — dokładnie raz.
- **Change ID:** trial-end-reminder
- **PRD refs:** FR-014
- **Prerequisites:** S-05
- **Parallel with:** S-03, S-04, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Jak wykryć, że przypomnienie nie wyszło (proces padł, e-mail odrzucony), skoro nie ma monitoringu? — Owner: user. Block: no.
- **Risk:** Rdzeń obietnicy produktu i wg pre-mortem w `infrastructure.md` najcichsza możliwa awaria; ryzyko duplikatów lub pominięć przy restarcie procesu.
- **Status:** proposed

### S-07: Ostrzeżenie o duplikatach w kategorii

- **Outcome:** użytkownik ustawia próg aktywnych subskrypcji per kategoria (domyślnie 2) i po dodaniu lub edycji subskrypcji widzi na dashboardzie flagę przy kategorii, która go przekracza.
- **Change ID:** category-duplicate-warning
- **PRD refs:** FR-009, FR-005
- **Prerequisites:** S-04
- **Parallel with:** S-03, S-05, S-06, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Prosta reguła, ale musi się przeliczać po każdej zmianie (Business Logic); stoi po S-04, bo flaga żyje na dashboardzie.
- **Status:** proposed

### S-08: Limity budżetu i alerty

- **Outcome:** użytkownik ustawia miesięczny limit całościowy i limity per kategoria, a dashboard pokazuje alert przy 80% i 100% limitu, przeliczany po dodaniu lub edycji subskrypcji.
- **Change ID:** budget-limits-and-alerts
- **PRD refs:** FR-010, FR-011, FR-005
- **Prerequisites:** S-04
- **Parallel with:** S-03, S-05, S-06, S-07, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Opiera się na sumach z S-04 — błąd tam daje fałszywe alerty; progi stałe 80/100% (konfigurowalne odłożone jako FR-017).
- **Status:** proposed

### S-09: Zarządzanie kontami przez administratora

- **Outcome:** administrator (rola nadana ręcznie poza aplikacją) odblokowuje konto lub resetuje dostęp użytkownika i ma wgląd w jego dane, w tym subskrypcje i kwoty.
- **Change ID:** admin-account-management
- **PRD refs:** FR-002
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Co dokładnie oznacza „zablokowane konto” i „reset dostępu” przy logowaniu wyłącznie magic linkiem? — Owner: user. Block: no.
- **Risk:** Niezależna gałąź — może iść równolegle z resztą; ryzyko w tym, że wyjątek od izolacji kont (pełny wgląd admina) przecieknie do zwykłych użytkowników.
- **Status:** proposed

### S-10: Usunięcie konta

- **Outcome:** użytkownik usuwa swoje konto z poziomu aplikacji. Przed usunięciem widzi potwierdzenie z informacją, że dane (subskrypcje, własne kategorie) przepadną bezpowrotnie. Po usunięciu jest wylogowany, a jego sesje, tokeny logowania i dane domenowe znikają.
- **Change ID:** account-deletion
- **PRD refs:** NFR „dane osobowe/finansowe usuwane lub anonimizowane w ciągu 30 dni od żądania usunięcia konta” (`prd.md`, Non-Functional)
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-09
- **Blockers:** —
- **Unknowns:**
  - Usunięcie natychmiastowe czy z okresem karencji (≤ 30 dni) i możliwością cofnięcia? — Owner: user. Block: no.
  - Co z wpisami w `mail` (adres odbiorcy bez FK do `user`) i z kopiami bazy z deployu (`backups/`, retencja)? — Owner: user. Block: no.
- **Ustalenia z S-02:** `subscription` i własne `category` mają już `ON DELETE CASCADE` na `user_id` (test e2e kaskady). `session`, `magic_link_token` i `user_role` mają `NO ACTION` — trzeba je usunąć w tej samej transakcji albo zmienić migracją na kaskadę.
- **Risk:** Operacja nieodwracalna: potwierdzenie (np. wpisanie adresu), CSRF jak przy innych zmianach stanu, unieważnienie wszystkich sesji użytkownika i test e2e, że po usunięciu nic po koncie nie zostaje. Wspólna logika z dezaktywacją w S-09.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                    | Ready for `/10x-plan` | Notes                                  |
| ---------- | ---------------------------- | -------------------------------------------------------- | --------------------- | -------------------------------------- |
| F-01       | production-database-wiring   | Produkcyjna baza, migracje w deployu i CORS frontend→API | yes                   | Run `/10x-plan production-database-wiring` |
| S-01       | magic-link-sign-in           | Logowanie magic linkiem                                   | yes                   | Run `/10x-plan magic-link-sign-in`     |
| F-02       | ui-foundation                | Motyw Angular Material i docelowy układ ekranów S-01      | yes                   | Run `/10x-plan ui-foundation`          |
| S-02       | first-subscription-in-list   | Dodanie subskrypcji i lista subskrypcji                   | no                    | Gotowe do planowania; gwiazda przewodnia |
| S-03       | edit-and-delete-subscription | Edycja i usuwanie subskrypcji                             | no                    | Czeka na S-02                          |
| S-04       | dashboard-cost-totals        | Dashboard: sumy miesięczne i roczne per kategoria         | no                    | Czeka na S-02                          |
| S-05       | subscription-lifecycle       | Automatyczne przejścia cyklu życia subskrypcji            | no                    | Czeka na S-02                          |
| S-06       | trial-end-reminder           | E-mail 7 dni przed końcem triala                          | no                    | Czeka na S-05                          |
| S-07       | category-duplicate-warning   | Ostrzeżenie o duplikatach w kategorii                     | no                    | Czeka na S-04                          |
| S-08       | budget-limits-and-alerts     | Limity budżetu i alerty 80% / 100%                        | no                    | Czeka na S-04                          |
| S-09       | admin-account-management     | Panel administratora: odblokowanie i reset dostępu       | no                    | Czeka na S-02                          |
| F-03       | frontend-unit-tests          | Test runner i testy jednostkowe frontendu w CI            | no                    | Czeka na S-02; przed S-03              |
| S-10       | account-deletion             | Usunięcie konta przez użytkownika                         | no                    | Czeka na S-02                          |

## Open Roadmap Questions

1. **Jak w MVP realizujemy usunięcie lub anonimizację danych w ciągu 30 dni od żądania (NFR)?** Ręcznie przez administratora (rozszerzenie S-09) czy samoobsługowo? — Owner: user. Block: — (nie blokuje planowania; dotyczy S-09).
2. **Czy poczta MyDevil wystarczy dla magic linku i przypomnień, czy potrzebny jest zewnętrzny dostawca e-maili?** Test dostarczalności przed startem. Na produkcji 2026-11-09 maile dochodzą na Gmaila i Outlooka, SPF PASS, DKIM brak, DMARC FAIL; pytanie zostaje otwarte do naprawy DKIM i DMARC. — Owner: user. Block: — (dotyczy S-01, S-06).
3. **Czy MVP potrzebuje choćby minimalnego alarmu, gdy backend lub zadania cykliczne przestaną działać?** Wg pre-mortem w `infrastructure.md` o awarii dowiemy się od użytkownika. — Owner: user. Block: — (dotyczy S-06).

## Parked

- **Scraping promocji od dostawców** — Why parked: PRD §Non-Goals (ryzyko techniczne i prawne).
- **Współdzielone subskrypcje / split kosztów** — Why parked: PRD §Non-Goals (backlog v2).
- **Rekomendacja przejścia na plan roczny** — Why parked: PRD §Non-Goals (backlog v2).
- **Historia zmian cen w czasie** — Why parked: PRD §Non-Goals (backlog v2).
- **Obsługa wielu walut** — Why parked: PRD §Non-Goals (MVP tylko PLN).
- **FR-003: logowanie e-mailem i hasłem** — Why parked: nice-to-have; cel `speed`, magic link wystarcza.
- **FR-012: prognoza przekroczenia budżetu przed dodaniem** — Why parked: nice-to-have; alert po dodaniu (FR-011) pokrywa potrzebę.
- **FR-015: okresowy e-mail podsumowujący alerty** — Why parked: nice-to-have; druga funkcja mailowa obok S-06.
- **FR-016: sortowanie i filtrowanie listy** — Why parked: nice-to-have, w PRD planowane na v2/v3.
- **FR-017: konfigurowalne progi alertów budżetowych** — Why parked: nice-to-have, w PRD planowane na v2.
- **NFR: powiadomienie o koncie nieaktywnym 12 miesięcy** — Why parked: pierwsze takie konta pojawią się najwcześniej rok po starcie; cel `speed`.
- **Monitoring i alerty produkcyjne poza logami procesów** — Why parked: cel `speed` i ryzyko `time`; decyzja otwarta w Open Roadmap Questions #3.
- **Edycja i usuwanie własnych kategorii** — Why parked: poza zakresem S-02 (2026-11-11). Usunięcie kategorii trafi w FK `subscription.category_id` (`NO ACTION` → `23503`), więc musi przepiąć subskrypcje albo zwrócić 409 zamiast 500; do tego helper `isForeignKeyViolation` obok `src/shared/database/unique-violation.ts`.
- **Ikony form płatności na liście subskrypcji** — Why parked: opcja dodatkowa z S-02 (2026-11-11). Ikona (inline SVG, z etykietą dla czytnika ekranu) zamiast tekstu formy płatności; w kompaktowej tabeli (container query poniżej 680 px) zastąpiłaby dopisek „· BLIK” pod nazwą i zajęła mniej miejsca.

## Milestone History

## Done

- **F-01: (foundation) API łączy się z produkcyjną bazą danych, deploy robi kopię bazy i uruchamia migracje przed przełączeniem wersji, a frontend z innej subdomeny może wywołać API (pierwsze wywołanie potwierdzone na produkcji). Bez tabel domenowych — te dochodzą w slice'ach.** — Archived 2026-10-28 → `context/archive/2026-10-16-production-database-wiring/`. Lesson: —.
- **S-01: użytkownik rejestruje się e-mailem (z oświadczeniem o pełnoletności i akceptacją polityki prywatności) albo przy kolejnym wejściu wpisuje e-mail, dostaje jednorazowy, ograniczony czasowo link, loguje się nim i widzi swoją (na razie pustą) listę subskrypcji; inni użytkownicy nie mają do niej dostępu.** — Archived 2026-11-09 → `context/archive/2026-11-03-magic-link-sign-in/`. Lesson: —.
- **F-02: (foundation) istniejące ekrany S-01 mają docelowy wygląd i układ na desktopie i telefonie (Angular Material z motywem projektu), pod `/` jest strona startowa renderowana na serwerze, a kolejne slice'y korzystają z gotowego motywu, formularzy, przycisków i szkieletu strony.** — Archived 2026-11-11 → `context/archive/2026-11-10-ui-foundation/`. Lesson: —.
