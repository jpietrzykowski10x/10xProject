---
project: SubTracker
version: 1
status: draft
created: 2026-10-16
updated: 2026-10-28
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
| F-01 | production-database-wiring        | (foundation) API ma produkcyjną bazę z migracjami w deployu; frontend woła API    | —             | Access Control, Guardrails    | in-progress |
| S-01 | magic-link-sign-in                | użytkownik loguje się magic linkiem i widzi swoją (pustą) listę subskrypcji       | F-01          | FR-001, US-01                 | proposed |
| S-02 | first-subscription-in-list        | użytkownik dodaje subskrypcję ze wszystkimi szczegółami i widzi ją na liście      | S-01          | FR-004, FR-007, FR-018, US-01 | proposed |
| S-03 | edit-and-delete-subscription      | użytkownik poprawia lub usuwa błędnie dodaną subskrypcję                          | S-02          | FR-005, FR-006                | proposed |
| S-04 | dashboard-cost-totals             | użytkownik widzi sumę miesięczną i roczną z podziałem na kategorie                | S-02          | FR-008, US-01                 | proposed |
| S-05 | subscription-lifecycle            | subskrypcja sama przechodzi trial → active i cancelled_pending → cancelled        | S-02          | FR-013                        | proposed |
| S-06 | trial-end-reminder                | użytkownik dostaje e-mail 7 dni przed końcem okresu próbnego                      | S-05          | FR-014                        | proposed |
| S-07 | category-duplicate-warning        | użytkownik widzi ostrzeżenie, gdy kategoria przekroczy jego próg subskrypcji      | S-04          | FR-009, FR-005                | proposed |
| S-08 | budget-limits-and-alerts          | użytkownik ustawia limity budżetu i widzi alert przy 80% / 100%                   | S-04          | FR-010, FR-011, FR-005        | proposed |
| S-09 | admin-account-management          | administrator odblokowuje konto lub resetuje dostęp i wgląda w dane użytkownika   | S-02          | FR-002                        | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                                   | Note                                                                                   |
| ------ | ---------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| A      | Rdzeń: konto i lista   | `F-01` → `S-01` → `S-02` → `S-03`       | Ścieżka krytyczna do gwiazdy przewodniej; wszystko inne startuje od `S-02`.            |
| B      | Koszt i alerty         | `S-04` → `S-07`, `S-08`                 | Dołącza do Stream A po `S-02`; `S-07` i `S-08` mogą iść równolegle po `S-04`.          |
| C      | Cykl życia i e-mail    | `S-05` → `S-06`                         | Dołącza do Stream A po `S-02`; najbardziej ryzykowna technicznie gałąź — nie zwlekać.  |
| D      | Administracja          | `S-09`                                  | Dołącza do Stream A po `S-02`; niezależna od B i C.                                    |

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
- **Status:** in-progress

## Slices

### S-01: Logowanie magic linkiem

- **Outcome:** użytkownik wpisuje e-mail, dostaje jednorazowy, ograniczony czasowo link, loguje się nim i widzi swoją (na razie pustą) listę subskrypcji; inni użytkownicy nie mają do niej dostępu.
- **Change ID:** magic-link-sign-in
- **PRD refs:** FR-001, US-01
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy e-maile z poczty MyDevil docierają do Gmaila/Outlooka (SPF/DKIM/DMARC domeny, reputacja współdzielonego IP)? — Owner: user. Block: no.
  - Jak długo ważny jest link i jak długo trwa sesja? — Owner: user. Block: no.
- **Risk:** Pierwszy slice użytkowy, bo wszystko inne wymaga zalogowanego użytkownika; ryzyko w dostarczalności e-maila i w ciasteczku sesji między subdomenami — widoki dla zalogowanego nie mogą być prerenderowane statycznie.
- **Status:** proposed

### S-02: Pierwsza subskrypcja na liście

- **Outcome:** użytkownik dodaje subskrypcję (nazwa, kategoria z predefiniowanej listy lub własna, kwota w PLN, cykl miesięczny/roczny, forma płatności z zamkniętej listy, status, data końca triala, data następnego rozliczenia) i natychmiast widzi ją w tabeli wszystkich swoich subskrypcji.
- **Change ID:** first-subscription-in-list
- **PRD refs:** FR-004, FR-007, FR-018, US-01
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Jaka jest predefiniowana lista kategorii na start? — Owner: user. Block: no.
- **Risk:** Gwiazda przewodnia — stoi zaraz po logowaniu; ryzyko w czasie przejścia (< 3 min wg kryterium sukcesu), więc formularz musi być krótki mimo wielu pól.
- **Status:** proposed

### S-03: Edycja i usuwanie subskrypcji

- **Outcome:** użytkownik poprawia dane istniejącej subskrypcji albo trwale usuwa błędnie dodaną — odrębnie od anulowania usługi w cyklu życia.
- **Change ID:** edit-and-delete-subscription
- **PRD refs:** FR-005, FR-006
- **Prerequisites:** S-02
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

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                    | Ready for `/10x-plan` | Notes                                  |
| ---------- | ---------------------------- | -------------------------------------------------------- | --------------------- | -------------------------------------- |
| F-01       | production-database-wiring   | Produkcyjna baza, migracje w deployu i CORS frontend→API | yes                   | Run `/10x-plan production-database-wiring` |
| S-01       | magic-link-sign-in           | Logowanie magic linkiem                                   | no                    | Czeka na F-01                          |
| S-02       | first-subscription-in-list   | Dodanie subskrypcji i lista subskrypcji                   | no                    | Czeka na S-01; gwiazda przewodnia      |
| S-03       | edit-and-delete-subscription | Edycja i usuwanie subskrypcji                             | no                    | Czeka na S-02                          |
| S-04       | dashboard-cost-totals        | Dashboard: sumy miesięczne i roczne per kategoria         | no                    | Czeka na S-02                          |
| S-05       | subscription-lifecycle       | Automatyczne przejścia cyklu życia subskrypcji            | no                    | Czeka na S-02                          |
| S-06       | trial-end-reminder           | E-mail 7 dni przed końcem triala                          | no                    | Czeka na S-05                          |
| S-07       | category-duplicate-warning   | Ostrzeżenie o duplikatach w kategorii                     | no                    | Czeka na S-04                          |
| S-08       | budget-limits-and-alerts     | Limity budżetu i alerty 80% / 100%                        | no                    | Czeka na S-04                          |
| S-09       | admin-account-management     | Panel administratora: odblokowanie i reset dostępu       | no                    | Czeka na S-02                          |

## Open Roadmap Questions

1. **Jak w MVP realizujemy usunięcie lub anonimizację danych w ciągu 30 dni od żądania (NFR)?** Ręcznie przez administratora (rozszerzenie S-09) czy samoobsługowo? — Owner: user. Block: — (nie blokuje planowania; dotyczy S-09).
2. **Czy poczta MyDevil wystarczy dla magic linku i przypomnień, czy potrzebny jest zewnętrzny dostawca e-maili?** Test dostarczalności przed startem. — Owner: user. Block: — (dotyczy S-01, S-06).
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

## Milestone History

## Done
