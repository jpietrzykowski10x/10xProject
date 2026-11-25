---
project: SubTracker
version: 2
status: draft
created: 2026-10-16
updated: 2026-11-25
prd_version: 2
main_goal: quality
top_blocker: time
milestone_id: observable-production-and-categories
milestone_seq: 2
milestone_status: open
---

# Roadmap: SubTracker

> Derived from `context/foundation/prd.md` (v2) + audyt obserwowalności `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` + baseline po M-1.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index. Pozycje M-1 (F-01…F-03, S-01…S-10) są w `## Done` i `## Milestone History`; numeracja M-2 zaczyna się od S-11, żeby ID się nie powtarzały.

## Milestone

**M-2: Widoczna produkcja i porządek w kategoriach** — Status: open

- **Intent:** Operator dowiaduje się o awarii API, zadań cyklicznych i wysyłki maili z alarmu, a nie od użytkownika, i z jednej linii logu wie, gdzie i w której wersji coś padło (poprawki po audycie obserwowalności). Użytkownik może poprawić albo usunąć błędnie wpisaną własną kategorię i sortować oraz filtrować listę subskrypcji.
- **Source materials:** `context/foundation/prd.md` (v2), w części „Niezawodność i diagnostyka (operator, v2)”, oraz raport audytu z 2026-11-22 (ID ustaleń przy FR-019…FR-024).
- **Done when:** każde S-NN poniżej ma status `done`, a powtórny `/10x-observability-audit` pokazuje w „Changes since last audit” zamknięte ustalenia krytyczne P1, J1, J2 i L1.
- **Scope anchors:** FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025 (must-have v2); FR-009, FR-010 (spójność przy usuwaniu kategorii). Nice-to-have: FR-016.
- **Sposób dostarczania (nie slice'y):** przed pierwszym PR-em M-2 osobny `chore/` z `/10x-impl-review-ci` w GitHub Actions, żeby każdy PR M-2 dostał automatyczny przegląd; S-14 i S-18 idą przez `/goal` + `/10x-goal-implement` (wąskie, dobrze sprawdzalne testami), reszta przez `/10x-implement` albo `/10x-tdd`. Zielony przebieg bez nadzoru nie zamyka slice'u: przegląd commitów i ręczna checklista przed merge'em.
- **Kolejne kamienie milowe (plan, nie zobowiązanie):** M-3 — nice-to-have z v1: FR-012, FR-017, FR-015, FR-003; M-4 — FR-026, FR-027 i NFR o kontach nieaktywnych 12 miesięcy. Szczegóły w `## Parked`. Cel: cały zakres przed `hard_deadline` z PRD (2026-12-06), a jeśli się nie uda, M-3 i M-4 idą po nim.

## Vision recap

Osoby korzystające z wielu subskrypcji i wielu kart tracą kontrolę nad cyklicznymi zobowiązaniami: przegapiają koniec okresów próbnych, płacą za nakładające się usługi i nie wiedzą, ile realnie wydają miesięcznie. SubTracker zbiera te zobowiązania w jednym miejscu, przelicza je do wspólnego mianownika (miesiąc/rok) i sam pilnuje duplikatów, budżetu i końców triali. Po M-1 wszystko to działa na produkcji; M-2 sprawia, że awaria tej automatyki nie przejdzie niezauważona.

## North star

**S-11: Operator dostaje mail, gdy API leży albo zadanie cykliczne nie przeszło** — gwiazda przewodnia (najmniejszy przepływ end-to-end, którego działanie dowodzi, że kamień milowy spełnia swoją obietnicę) stoi pierwsza, bo dziś API w pętli restartów albo job cyklu życia niedziałający tygodniami wyglądają w logach jak cisza; zamyka 3 z 4 krytycznych ustaleń audytu i odpowiada na dawne pytanie roadmapy o minimalny alarm.

## At a glance

| ID   | Change ID                          | Outcome (user can …)                                                                 | Prerequisites | PRD refs                | Status   |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------ | ------------- | ----------------------- | -------- |
| S-11 | operator-liveness-alerts           | operator dostaje mail, gdy API nie odpowiada albo job padł lub nie ruszył przez 26 h | —             | FR-019                  | done        |
| S-12 | independent-alert-channel          | alarm operatora dochodzi także przy awarii SMTP dla użytkowników                     | S-11          | FR-020                  | done        |
| S-13 | request-context-and-denial-reasons | operator widzi w logu trasę, użytkownika i id żądania błędu oraz przyczyny odmów 4xx  | —             | FR-021                  | done |
| S-14 | log-format-version-and-access-log  | operator czyta logi w jednym formacie, z wersją i access logiem obu procesów         | S-13          | FR-022                  | done |
| S-15 | client-and-ssr-error-visibility    | błędy przeglądarki i SSR zostawiają ślad, a nieaktualny plik po deployu przeładowuje stronę | S-14     | FR-023                  | proposed |
| S-16 | failure-causes-and-audit-trail     | operator widzi przyczynę porażki joba i maila, a usunięcia i odmowy admina mają ślad | S-11          | FR-024                  | done |
| S-17 | own-category-rename-and-delete     | użytkownik zmienia nazwę własnej kategorii albo usuwa pustą                          | —             | FR-025, FR-009, FR-010  | done |
| S-18 | subscription-list-sort-filter      | użytkownik sortuje i filtruje listę subskrypcji                                      | —             | FR-016                  | ready    |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                         | Note                                                                                              |
| ------ | ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| A      | Alarmy i zadania       | `S-11` → `S-12`, `S-16`       | Gwiazda przewodnia; `S-12` i `S-16` mogą iść równolegle po `S-11`.                                |
| B      | Logi i diagnostyka     | `S-13` → `S-14` → `S-15`      | Równolegle ze Stream A; `S-14` dostaje id żądania z `S-13`, `S-15` dzieli z `S-14` `server.ts`.    |
| C      | Własne kategorie       | `S-17`                        | Kolejność wg PRD v2: zaraz po audycie; technicznie niezależna, może wejść wcześniej, gdy A i B czekają. |
| D      | Lista subskrypcji      | `S-18`                        | Nice-to-have; pierwszy kandydat na przebieg `/goal` bez nadzoru.                                   |

## Baseline

What's already in place in the codebase as of `2026-11-22` (po M-1; z `CLAUDE.md` i raportu audytu, potwierdzone przez użytkownika).
Slices below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Angular 22 z SSR, Angular Material, app-shell, widoki `/subscriptions`, `/dashboard`, `/budget`, `/account`, `/admin/users`.
- **Backend / API:** present — NestJS 12, moduły `auth/`, `users/`, `mail/`, `subscriptions/`, `admin/`, joby `@nestjs/schedule` (cykl życia, sprzątanie auth, przypomnienia o trialu).
- **Data:** present — PostgreSQL przez TypeORM, migracje w deployu, kopie bazy z retencją 180 dni.
- **Auth:** present — magic link, sesje w ciasteczku, role ADMIN i SUPER_ADMIN, blokada konta.
- **Deploy / infra:** present — GitHub Actions (`ci.yml`, `deploy-*.yml`), skrypty `deploy/mydevil/`, rollback, `prune-backups.sh` z crontaba.
- **Observability:** partial — tylko logi procesów pod `forever` i jeden alarm mailowy (nieudany przebieg przypomnień, nieudana wysyłka maila); brak trackera błędów, monitora dostępności, rejestru przebiegów jobów i kontekstu w logach (audyt 2026-11-22: 62 ustalenia, 4 krytyczne).

## Foundations

Brak w M-2. Każda warstwa jest `present`, a brakujące elementy obserwowalności wchodzą w pierwszym slice'ie, który ich potrzebuje (rejestr przebiegów jobów w S-11, identyfikator żądania w S-13). Przegląd w CI (`/10x-impl-review-ci`) jest zmianą sposobu dostarczania, opisaną w karcie kamienia milowego, a nie Foundation.

## Slices

### S-11: Alarm o padnięciu API i zadań cyklicznych

- **Outcome:** operator dostaje mail, gdy API przestaje odpowiadać albo pada w pętli restartów (sprawdzenie spoza procesu API), oraz gdy zadanie cykliczne zakończy się błędem albo nie zakończy się w ciągu 26 godzin; każdy przebieg zadania zostawia trwały ślad.
- **Change ID:** operator-liveness-alerts
- **PRD refs:** FR-019
- **Prerequisites:** —
- **Parallel with:** S-13, S-17, S-18
- **Blockers:** —
- **Unknowns:**
  - Interwał watchdoga i liczba porażek przed alarmem; czy watchdog pilnuje też frontendu SSR? — Owner: agent (`/10x-plan`). Block: no.
- **Risk:** Stoi pierwsza, bo zamyka P1, J1 i J2 (krytyczne) i daje kanał, z którego korzystają S-12 i S-16. Ryzyko w części poza kodem: skrypt watchdoga wgrywany ręcznie (`scp`) i wpis w crontabie, jak `prune-backups.sh`; joby zostają idempotentne (`lessons.md`), mail bez danych użytkowników.
- **Status:** done

### S-12: Niezależny kanał alarmów

- **Outcome:** alarm do operatora dochodzi także wtedy, gdy nie działa wysyłka maili do użytkowników: na produkcji wymagany jest osobny kanał alarmowy, blokada powtórzeń zaczyna działać dopiero po przyjęciu alarmu, a odrzucenie adresata przez serwer pocztowy jest odróżnione od literówki.
- **Change ID:** independent-alert-channel
- **PRD refs:** FR-020
- **Prerequisites:** S-11
- **Parallel with:** S-13, S-14, S-15, S-16, S-17, S-18
- **Blockers:** Osobna skrzynka alarmowa na MyDevil — do założenia przez użytkownika przed deployem (walidacja PROD w `env.ts` zatrzyma start bez niej).
- **Unknowns:**
  - ~~Drugi kanał na MyDevil czy zewnętrzny SMTP?~~ Rozstrzygnięte 2026-11-22: osobna skrzynka na MyDevil, bez zewnętrznych dostawców. Świadomie akceptowane ograniczenie: awaria całej poczty MyDevil wyłącza też alarmy (watchdog z S-11 nadal zapisuje porażki w logu).
- **Risk:** Po S-11, bo S-11 dodaje nowe wywołania alarmu, a S-12 utwardza ich drogę; ryzyko w deployu — nowy wymagany klucz w `shared/.env` przed merge'em.
- **Status:** done

### S-13: Kontekst żądania i przyczyny odmów w logu API

- **Outcome:** każdy błąd serwera w logu API ma metodę, szablon trasy, id użytkownika i id żądania; wybrane odmowy 4xx (weryfikacja linku, sesja, CSRF/Origin, ranga administratora, walidacja) zostawiają linię z kodem przyczyny i nazwami pól, bez wartości i danych osobowych, z limitem.
- **Change ID:** request-context-and-denial-reasons
- **PRD refs:** FR-021
- **Prerequisites:** —
- **Parallel with:** S-11, S-12, S-16, S-17, S-18
- **Blockers:** —
- **Unknowns:**
  - Limit linii odmów 4xx: per proces i okno czasowe czy per kod przyczyny? — Owner: agent (`/10x-plan`). Block: no.
- **Risk:** Zamyka L1 (krytyczne); ryzyko w odwróceniu świadomej decyzji „4xx nie logujemy” — powód (dane osobowe, rozrost logu przez obcy ruch) musi zostać spełniony testem, że linia nie zawiera adresu, tokenu ani query.
- **Status:** done

### S-14: Format logu, wersja i access log

- **Outcome:** logi obu procesów mają jednolity format bez kodów kolorów, ze znacznikiem czasu ISO ze strefą; linia startowa i `/health` podają wdrożoną wersję; każde żądanie zostawia jedną linię access logu (metoda, trasa, status, czas).
- **Change ID:** log-format-version-and-access-log
- **PRD refs:** FR-022
- **Prerequisites:** S-13
- **Parallel with:** S-11, S-12, S-16, S-17, S-18
- **Blockers:** —
- **Unknowns:**
  - Czy MyDevil rotuje i ogranicza logi `forever`? Access log zwiększy ich objętość. — Owner: user. Block: no.
- **Risk:** Po S-13, bo access log używa jego id żądania; wąski i dobrze sprawdzalny testami, więc kandydat na przebieg `/goal` + `/10x-goal-implement`.
- **Status:** done

### S-15: Błędy przeglądarki i SSR nie znikają

- **Outcome:** strony i formularze nie zamieniają nieznanego błędu w ogólny komunikat bez zapisu przyczyny, błąd nawigacji przy renderowaniu na serwerze nie wygląda jak 404, a nieaktualny plik aplikacji po wdrożeniu przeładowuje stronę.
- **Change ID:** client-and-ssr-error-visibility
- **PRD refs:** FR-023
- **Prerequisites:** S-14
- **Parallel with:** S-12, S-16, S-17, S-18
- **Blockers:** —
- **Unknowns:**
  - Czy błędy z przeglądarki mają trafiać do API (PRD Open Questions #2)? Do decyzji slice obejmuje tylko konsolę przeglądarki i log serwera SSR. — Owner: user. Block: no.
- **Risk:** Po S-14, bo oba zmieniają `server.ts` (access log, middleware błędów); ryzyko w zmianie zachowania guardów i formularzy widocznej dla użytkownika — testy e2e komunikatów muszą zostać zielone.
- **Status:** proposed

### S-16: Przyczyny porażek i ślad audytowy

- **Outcome:** zadania cykliczne i wysyłka maili rozróżniają przyczyny porażki (brak konta, konto zablokowane, błąd bazy, błąd SMTP), a usunięcie konta, odmowy akcji administratora i jego wyszukiwania zostawiają ślad audytowy.
- **Change ID:** failure-causes-and-audit-trail
- **PRD refs:** FR-024
- **Prerequisites:** S-11
- **Parallel with:** S-12, S-13, S-14, S-15, S-17, S-18
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Po S-11, bo przyczyny trafiają do jego rejestru przebiegów; ryzyko w zakresie (wiele drobnych ustaleń) — plan grupuje je w fazy wg modułu, a reszta z §6 pkt 8 raportu wchodzi tylko tam, gdzie slice i tak dotyka kodu.
- **Notes:** Przeniesione z przeglądu CI S-11 (PR #62, `context/changes/operator-liveness-alerts/reviews/impl-review.md`, F3): ścieżka „poprzedni przebieg trwa” (`recordSkipped` przy podniesionej fladze `running`) w trzech schedulerach nie ma testów; dopisać po jednym teście na scheduler (pierwszy przebieg trzymany otwarty, drugi zostawia wiersz `skipped`; dla przypomnień także: drugie wywołanie rozwiązuje się dopiero po pierwszym, na czym polega `idle()`). Z trzeciego przeglądu (PR #62, F3): testy granicy 12 h w `watchdog-policy.spec.ts` liczą czas ze stałej `REMIND_EVERY_HOURS`, więc zmianę progu łapie tylko test przypinający wartość; dopisać przypadki z dosłownymi czasami (11 h 59 min cicho, 12 h przypomnienie).
- **Status:** done

### S-17: Zmiana nazwy i usuwanie własnych kategorii

- **Outcome:** użytkownik zmienia nazwę własnej kategorii albo usuwa ją, jeśli nie ma w niej subskrypcji; przy niepustej widzi komunikat, że najpierw musi przenieść albo usunąć jej subskrypcje. Kategorie predefiniowane się nie zmieniają, a próg duplikatów i limit budżetu usuwanej kategorii nie zostają osierocone.
- **Change ID:** own-category-rename-and-delete
- **PRD refs:** FR-025, FR-009, FR-010
- **Prerequisites:** —
- **Parallel with:** S-11, S-12, S-13, S-14, S-15, S-16, S-18
- **Blockers:** —
- **Unknowns:**
  - ~~Co z subskrypcjami usuwanej kategorii?~~ Rozstrzygnięte 2026-11-22 (PRD Open Questions #1): usunąć można tylko pustą.
  - Gdzie w UI: na stronie budżetu, w formularzu subskrypcji czy na osobnej liście kategorii? — Owner: user (makiety ASCII wg `lessons.md`). Block: no.
- **Risk:** Kolejność wg PRD v2 — zaraz po poprawkach audytu, choć technicznie niezależny. Ryzyko w kluczu obcym `subscription.category_id` (`23503` musi dać 409, nie 500; helper w `shared/database/`), w unikalności nazw (`toNameKey`) przy zmianie nazwy i w sortowaniu z `POLISH_COLLATION`.
- **Status:** done

### S-18: Sortowanie i filtrowanie listy subskrypcji

- **Outcome:** użytkownik sortuje listę subskrypcji (np. po nazwie, kwocie, dacie rozliczenia) i filtruje ją (np. po kategorii, statusie).
- **Change ID:** subscription-list-sort-filter
- **PRD refs:** FR-016
- **Prerequisites:** —
- **Parallel with:** S-11, S-12, S-13, S-14, S-15, S-16, S-17
- **Blockers:** —
- **Unknowns:**
  - Sortowanie i filtrowanie w przeglądarce czy w API? Przy małej skali (PRD `target_scale: small`) przeglądarka wystarczy. — Owner: agent (`/10x-plan`). Block: no.
- **Risk:** Nice-to-have na koniec M-2; wąski zakres we froncie, więc pierwszy kandydat na przebieg `/goal` + `/10x-goal-implement`. Widok listy sprawdzany w trzech szerokościach (`lessons.md`).
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Change ID                          | Suggested issue title                                   | Ready for `/10x-plan` | Notes |
| ---------- | ---------------------------------- | ------------------------------------------------------- | --------------------- | ----- |
| S-11       | operator-liveness-alerts           | Watchdog API i rejestr przebiegów jobów z alarmem       | done                   | Zarchiwizowane 2026-11-22 |
| S-12       | independent-alert-channel          | Osobny kanał alarmów operatora                          | done                  | Zarchiwizowane 2026-11-24 |
| S-13       | request-context-and-denial-reasons | Kontekst żądania i przyczyny odmów 4xx w logu API       | done                   | Zarchiwizowane 2026-11-23 |
| S-14       | log-format-version-and-access-log  | Format logu, wersja i access log                        | no                    | Po S-13; kandydat na `/goal` |
| S-15       | client-and-ssr-error-visibility    | Widoczność błędów przeglądarki i SSR                    | no                    | Po S-14 |
| S-16       | failure-causes-and-audit-trail     | Przyczyny porażek jobów i maili, ślad audytowy          | no                    | Po S-11 |
| S-17       | own-category-rename-and-delete     | Zmiana nazwy i usuwanie pustej własnej kategorii        | done                  | Zarchiwizowane 2026-11-25 |
| S-18       | subscription-list-sort-filter      | Sortowanie i filtrowanie listy subskrypcji              | yes                   | Kandydat na `/goal` |

## Open Roadmap Questions

1. **Czy poczta MyDevil wystarczy dla magic linku, przypomnień i alarmów, czy potrzebny jest zewnętrzny dostawca e-maili?** Na produkcji 2026-11-09 maile dochodzą na Gmaila i Outlooka, SPF PASS, DKIM brak, DMARC FAIL; do naprawy DKIM i DMARC przed publicznym startem (konfiguracja bez kodu). — Owner: user. Block: — (dotyczy S-12 i M-3: FR-015).
2. **Czy błędy z przeglądarki mają trafiać do API?** (PRD Open Questions #2) — Owner: user. Block: — (S-15 bez tego endpointu).
3. **Czy MyDevil rotuje i ogranicza logi procesów?** Założenie niepotwierdzone w audycie; pętla restartów albo access log mogą zapełnić dysk. — Owner: user. Block: — (dotyczy S-11, S-14).
4. ~~Jak w MVP realizujemy usunięcie danych w 30 dni?~~ Rozstrzygnięte w M-1 (S-10). ~~Czy MVP potrzebuje minimalnego alarmu?~~ Tak — S-11 (M-2).

## Parked

- **Plan M-3 — FR-012: prognoza przekroczenia budżetu przed dodaniem** — Why parked: nice-to-have z v1, kolejność wg PRD v2 po M-2; czysta funkcja, kandydat na pierwsze użycie `/10x-tdd`.
- **Plan M-3 — FR-017: konfigurowalne progi alertów budżetowych** — Why parked: nice-to-have z v1, rozszerza S-08; pasuje do FR-012.
- **Plan M-3 — FR-015: okresowy e-mail podsumowujący alerty** — Why parked: nice-to-have z v1; korzysta z rejestru przebiegów (S-11) i kanału alarmów (S-12), dostarczalność zależy od DKIM i DMARC.
- **Plan M-3 — FR-003: logowanie e-mailem i hasłem** — Why parked: nice-to-have z v1, największe i najbardziej wrażliwe na bezpieczeństwo. Kilka nieudanych prób blokuje konto przez `is_active = false` z S-09 (decyzja 2026-11-21); samoobsługowe odblokowanie razem z nim.
- **Plan M-4 — FR-026: ikony form płatności na liście** — Why parked: nice-to-have v2 na koniec (PRD v2). Ikona inline SVG z etykietą dla czytnika ekranu; w kompaktowej tabeli (container query poniżej 680 px) zastąpiłaby dopisek „· BLIK” pod nazwą.
- **Plan M-4 — FR-027: zaufane urządzenia i mail „to nie ja”** — Why parked: nice-to-have v2 na koniec (PRD v2); blokada mechanizmem z S-09.
- **Plan M-4 — NFR: powiadomienie o koncie nieaktywnym 12 miesięcy** — Why parked: pierwsze takie konta pojawią się najwcześniej rok po starcie (PRD v2).
- **Scraping promocji od dostawców** — Why parked: PRD §Non-Goals (ryzyko techniczne i prawne).
- **Współdzielone subskrypcje / split kosztów** — Why parked: PRD §Non-Goals (backlog v2).
- **Rekomendacja przejścia na plan roczny** — Why parked: PRD §Non-Goals (backlog v2).
- **Historia zmian cen w czasie** — Why parked: PRD §Non-Goals (backlog v2).
- **Obsługa wielu walut** — Why parked: PRD §Non-Goals (MVP tylko PLN).
- **Limit wysyłki linków logowania i pool SMTP, rate limiting API** — Why parked: przed publicznym startem; brak FR w PRD v2 (follow-up z S-01 i S-09).
- **Widok audytu administratora w UI** — Why parked: pomysł z S-09 bez FR w PRD v2.

## Milestone History

- **M-1: MVP — kontrola subskrypcji i budżetu** (`mvp-subscription-control`) — closed 2026-11-22. Wszystkie FR konieczne z PRD v1 działają na produkcji: logowanie magic linkiem, lista z edycją i usuwaniem, sumy na dashboardzie, cykl życia i przypomnienie o trialu, duplikaty, limity budżetu, panel administratora i usunięcie konta (13/13 pozycji).

## Done

- **F-01: (foundation) API łączy się z produkcyjną bazą danych, deploy robi kopię bazy i uruchamia migracje przed przełączeniem wersji, a frontend z innej subdomeny może wywołać API (pierwsze wywołanie potwierdzone na produkcji). Bez tabel domenowych — te dochodzą w slice'ach.** — Archived 2026-10-28 → `context/archive/2026-10-16-production-database-wiring/`. Lesson: —.
- **S-01: użytkownik rejestruje się e-mailem (z oświadczeniem o pełnoletności i akceptacją polityki prywatności) albo przy kolejnym wejściu wpisuje e-mail, dostaje jednorazowy, ograniczony czasowo link, loguje się nim i widzi swoją (na razie pustą) listę subskrypcji; inni użytkownicy nie mają do niej dostępu.** — Archived 2026-11-09 → `context/archive/2026-11-03-magic-link-sign-in/`. Lesson: —.
- **F-02: (foundation) istniejące ekrany S-01 mają docelowy wygląd i układ na desktopie i telefonie (Angular Material z motywem projektu), pod `/` jest strona startowa renderowana na serwerze, a kolejne slice'y korzystają z gotowego motywu, formularzy, przycisków i szkieletu strony.** — Archived 2026-11-11 → `context/archive/2026-11-10-ui-foundation/`. Lesson: —.
- **S-02: użytkownik dodaje subskrypcję (nazwa, kategoria z predefiniowanej listy lub własna, kwota w PLN, cykl miesięczny/roczny, forma płatności z zamkniętej listy, status, data końca triala, data następnego rozliczenia) i natychmiast widzi ją w tabeli wszystkich swoich subskrypcji.** — Archived 2026-11-11 → `context/archive/2026-11-11-first-subscription-in-list/`. Lesson: —.
- **F-03: (foundation) `frontend-subtracker` ma działający test runner (`ng test` / `npm test`), testy jednostkowe uruchamiane w CI (`ci.yml`, job `frontend`) i pierwsze testy czystych helperów: `shared/decimal.ts` (`parseDecimal`), `shared/pl-date-adapter.ts` (`parse`, w tym 31.02 i `d.m.rrrr`), `shared/date-only.ts` (`daysFromToday`, `toDateOnly` bez przesunięcia strefy), `subscriptions/subscription-amounts.ts` (`monthlyAmount`) i walidatory formularza subskrypcji. Kontrola celowego uszkodzenia dla każdego testu.** — Archived 2026-11-13 → `context/archive/2026-11-13-frontend-unit-tests/`. Lesson: —.
- **S-03: użytkownik poprawia dane istniejącej subskrypcji albo trwale usuwa błędnie dodaną — odrębnie od anulowania usługi w cyklu życia.** — Archived 2026-11-15 → `context/archive/2026-11-15-edit-and-delete-subscription/`. Lesson: —.
- **S-04: użytkownik widzi na dashboardzie łączny koszt subskrypcji miesięcznie i rocznie, z podziałem na kategorie, zgodny z ręcznym wyliczeniem.** — Archived 2026-11-15 → `context/archive/2026-11-15-dashboard-cost-totals/`. Lesson: —.
- **S-05: użytkownik anuluje subskrypcję (trafia do cancelled_pending), a system sam przenosi subskrypcje trial → active po dacie końca triala i cancelled_pending → cancelled po dacie następnego rozliczenia.** — Archived 2026-11-16 → `context/archive/2026-11-15-subscription-lifecycle/`. Lesson: —.
- **S-06: użytkownik z subskrypcją w trialu dostaje e-mail 7 dni przed końcem okresu próbnego — dokładnie raz.** — Archived 2026-11-16 → `context/archive/2026-11-16-trial-end-reminder/`. Lesson: —.
- **S-07: użytkownik ustawia próg aktywnych subskrypcji per kategoria (domyślnie 2) i po dodaniu lub edycji subskrypcji widzi na dashboardzie flagę przy kategorii, która go przekracza.** — Archived 2026-11-17 → `context/archive/2026-11-17-category-duplicate-warning/`. Lesson: —.
- **S-08: użytkownik ustawia miesięczny limit całościowy i limity per kategoria, a dashboard pokazuje alert przy 80% i 100% limitu, przeliczany po dodaniu lub edycji subskrypcji.** — Archived 2026-11-18 → `context/archive/2026-11-17-budget-limits-and-alerts/`. Lesson: —.
- **S-10: użytkownik usuwa swoje konto z poziomu aplikacji. Przed usunięciem widzi potwierdzenie z informacją, że dane (subskrypcje, własne kategorie) przepadną bezpowrotnie. Po usunięciu jest wylogowany, a jego sesje, tokeny logowania i dane domenowe znikają.** — Archived 2026-11-21 → `context/archive/2026-11-20-account-deletion/`. Lesson: —.
- **S-09: administrator (rola nadana ręcznie poza aplikacją) blokuje i odblokowuje konto lub resetuje dostęp użytkownika i ma wgląd w jego dane, w tym subskrypcje i kwoty.** — Archived 2026-11-21 → `context/archive/2026-11-21-admin-account-management/`. Lesson: widok listy w trzech szerokościach; przyciski i pola z tokenów motywu.
- **S-11: operator dostaje mail, gdy API przestaje odpowiadać albo pada w pętli restartów (sprawdzenie spoza procesu API), oraz gdy zadanie cykliczne zakończy się błędem albo nie zakończy się w ciągu 26 godzin; każdy przebieg zadania zostawia trwały ślad.** — Archived 2026-11-23 → `context/archive/2026-11-22-operator-liveness-alerts/`. Lesson: —.
- **S-13: każdy błąd serwera w logu API ma metodę, szablon trasy, id użytkownika i id żądania; wybrane odmowy 4xx (weryfikacja linku, sesja, CSRF/Origin, ranga administratora, walidacja) zostawiają linię z kodem przyczyny i nazwami pól, bez wartości i danych osobowych, z limitem.** — Archived 2026-11-23 → `context/archive/2026-11-23-request-context-and-denial-reasons/`. Lesson: —.
- **S-12: alarm do operatora dochodzi także wtedy, gdy nie działa wysyłka maili do użytkowników: na produkcji wymagany jest osobny kanał alarmowy, blokada powtórzeń zaczyna działać dopiero po przyjęciu alarmu, a odrzucenie adresata przez serwer pocztowy jest odróżnione od literówki.** — Archived 2026-11-24 → `context/archive/2026-11-23-independent-alert-channel/`. Lesson: —.
- **S-16: zadania cykliczne i wysyłka maili rozróżniają przyczyny porażki (brak konta, konto zablokowane, błąd bazy, błąd SMTP), a usunięcie konta, odmowy akcji administratora i jego wyszukiwania zostawiają ślad audytowy.** — Archived 2026-11-24 → `context/archive/2026-11-24-failure-causes-and-audit-trail/`. Lesson: —.
- **S-14: logi obu procesów mają jednolity format bez kodów kolorów, ze znacznikiem czasu ISO ze strefą; linia startowa i `/health` podają wdrożoną wersję; każde żądanie zostawia jedną linię access logu (metoda, trasa, status, czas).** — Archived 2026-11-25 → `context/archive/2026-11-24-log-format-version-and-access-log/`. Lesson: —.
- **S-17: użytkownik zmienia nazwę własnej kategorii albo usuwa ją, jeśli nie ma w niej subskrypcji; przy niepustej widzi komunikat, że najpierw musi przenieść albo usunąć jej subskrypcje. Kategorie predefiniowane się nie zmieniają, a próg duplikatów i limit budżetu usuwanej kategorii nie zostają osierocone.** — Archived 2026-11-25 → `context/archive/2026-11-24-own-category-rename-and-delete/`. Lesson: —.
