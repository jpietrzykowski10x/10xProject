---
date: 2026-11-15T19:48:39+01:00
researcher: Claude (Opus 5.5) dla Jakub Pietrzykowski
git_commit: afa5bf1ce26a133971183696c0c482ba22ed3ada
branch: change/subscription-lifecycle
repository: jpietrzykowski10x/10xProject
topic: "S-05 subscription-lifecycle — stan wyjściowy kodu i decyzji przed planowaniem maszyny stanów i joba przejść"
tags: [research, backend-subtracker, frontend-subtracker, subscriptions, lifecycle, scheduler, timezone]
status: complete
last_updated: 2026-11-15
last_updated_by: Claude (Opus 5.5)
---

# Research: S-05 subscription-lifecycle

**Date**: 2026-11-15T19:48:39+01:00
**Researcher**: Claude (Opus 5.5) dla Jakub Pietrzykowski
**Git Commit**: afa5bf1 (main po merge PR #37; zmiany robocze tylko w `context/changes/subscription-lifecycle/`)
**Branch**: change/subscription-lifecycle
**Repository**: jpietrzykowski10x/10xProject

## Research Question

Co już istnieje w kodzie i w decyzjach projektu, na czym S-05 musi zbudować: (1) user anuluje subskrypcję → `cancelled_pending`, (2) system sam przenosi `trial → active` po dacie końca triala i `cancelled_pending → cancelled` po dacie następnego rozliczenia (FR-013, `context/foundation/prd.md:95`; `context/foundation/roadmap.md:180-192`). Jakie kontrakty S-05 dotknie i które wybory pozostają otwarte (przejścia wyzwalane przez użytkownika, strefa czasowa).

## Summary

- **Status to dziś wolne pole.** Backend trzyma `status` jako `varchar(32)` + enum TS z 4 wartościami, bez CHECK w bazie (`backend-subtracker/src/subscriptions/entities/subscription.entity.ts:59-60`, `subscription.types.ts:2-7`). Jeden DTO obsługuje `POST` i `PUT` i przyjmuje każdy z 4 statusów (`dtos/create-subscription.dto.ts:78-79`); `update()` robi pełne zastąpienie bez porównania starego i nowego statusu (`services/subscriptions.service.ts:138-160`). Frontend w formularzu oferuje wszystkie 4 statusy przy dodawaniu i edycji (`frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:168`). Anulowanie usługi odbywa się dziś wyłącznie przez edycję statusu — tak też instruuje dialog usuwania (`delete-subscription-dialog.html:7-11`). Nie ma endpointu ani akcji „anuluj”.
- **Brak schedulera.** `@nestjs/schedule` nie ma w `backend-subtracker/package.json`, w `src/` nie ma żadnego crona/interwału; `app.module.ts:16-48` nie importuje `ScheduleModule`.
- **Daty są gotowe do pracy joba**: `trial_end_date date NULL`, `next_billing_date date NOT NULL` (`subscription.entity.ts:62-66`; migracja `1794406389791-SubscriptionsSchema.ts:14`). Reguły S-02: trial wymaga daty końca, inne statusy jej nie mają, `next_billing_date >= trial_end_date` dla triala, daty z przeszłości dozwolone (`create-subscription.dto.ts:24-57,84-86`). Nie ma indeksu na `status` ani na datach (ta sama migracja, `:17,:20` — tylko `user_id`, `category_id`).
- **„Dziś” po stronie backendu nie istnieje.** Brak helpera, brak `CURRENT_DATE`, brak `TZ` w env/opcjach bazy/skryptach MyDevil (`src/config/env.ts:6-36`, `src/database/database.options.ts:99-142`, `deploy/mydevil/start-app.sh:18-44`). Strefa procesu i sesji Postgresa na MyDevil nie jest nigdzie udokumentowana. Strefa czasowa jest otwartym Unknown roadmapy (`roadmap.md:190`); `infrastructure.md:76,102` zaleca jawne `Europe/Warsaw` w `@Cron`.
- **Jeden proces API, restarty w dowolnej chwili.** `forever` z jednym `--uid subtracker-api`, każdy start poprzedza stop (`start-app.sh:20,32-44`), deploy zatrzymuje API na 30–60 s, rollback przywraca dump sprzed deployu (`deploy/mydevil/README.md:75-97`). Lekcja: joby idempotentne, przetwarzają zaległe, nie zakładają poprzedniego uruchomienia (`context/foundation/lessons.md` — „Zadania cykliczne nadrabiają pominięte uruchomienia”).
- **Konsumenci statusu** (przeszukane `backend-subtracker/src`): sumy (`cost-totals.ts:14-18`, `COUNTED_STATUSES` = trial, active, cancelled_pending; to samo „aktywne” dla S-07/S-08) i sortowanie listy (`subscription-order.ts:5-10,25-36`). Przejście `cancelled_pending → cancelled` zdejmuje subskrypcję z sum; `trial → active` nie zmienia sum.
- **Otwarte wybory produktowe** (żaden dokument ich nie rozstrzyga): które przejścia wolno wywołać użytkownikowi (cofnięcie anulowania, czy `PUT` dalej przyjmuje dowolny status), strefa czasowa „dziś”, co z `active` z datą rozliczenia w przeszłości (przesuwanie `next_billing_date` — nigdzie nie wspomniane), czy job ma też sprzątać tokeny/sesje (przekazane do S-05 w S-01).

## Detailed Findings

### Model danych i walidacja (backend)

- Encja: `status` `varchar(32)` typowany `SubscriptionStatus` (`subscription.entity.ts:59-60`), `trialEndDate` `date` nullable (`:62-63`), `nextBillingDate` `date` NOT NULL (`:65-66`), `createdAt` timestamptz (`:68-69`). Brak `updatedAt`, brak kolumny wersji — update to last-write-wins.
- Migracja `src/database/migrations/1794406389791-SubscriptionsSchema.ts:14` — definicja kolumn; indeksy tylko `user_id` (`:17`) i `category_id` (`:20`). Żadna późniejsza migracja nie dotyka `subscription` (sprawdzone: grep po `src/database/migrations`).
- Statusy: `src/subscriptions/subscription.types.ts:2-7` (moduł funkcji, nie `shared/` — zgodnie z lekcją o `shared/`).
- DTO `dtos/create-subscription.dto.ts` dla `POST` i `PUT` (kontroler `controllers/subscriptions.controller.ts:40-57`; brak `PATCH`):
  - `@IsEnum(SubscriptionStatus)` wymagany, `:78-79` — każdy z 4 statusów na obu trasach.
  - `TrialEndDateRule` `:24-35`: data wymagana dla `trial`, w innych statusach brak/null.
  - `NotBeforeTrialEnd` `:38-57`: dla triala `nextBillingDate >= trialEndDate` (porównanie stringów).
  - `nextBillingDate` zawsze wymagany, `@IsDateOnly`, `:84-86`; przeszłość dozwolona (komentarz `:59`).
- Serwis: `subscriptionFields` (`subscriptions.service.ts:40-57`) kopiuje status i zeruje `trialEndDate` poza trialem; `update` (`:138-160`) czyta wiersz, ale nie porównuje statusów; używa `repository.update`, nie `save` (`:149-152`).
- Walidator dnia: `src/shared/validation/date-only.ts:7-33` (format + istnienie dnia przez `Date.UTC`). Brak funkcji „dziś”.

### Konsumenci statusu

- Sumy: `src/subscriptions/cost-totals.ts:10-18` — lista włączająca, komentarz wiąże ją z S-07/S-08; filtr SQL `status IN (:...statuses)` w `subscriptions.service.ts:108-110`.
- Kolejność listy: `src/subscriptions/subscription-order.ts:5-10` (active+trial=0, cancelled_pending=1, cancelled=2) i `:25-36` (data odniesienia: `trial_end_date` dla triala, inaczej `next_billing_date`; komentarz `:33-34`: dla anulowanej to dzień, do którego „działa lub działała”).
- Frontend nie filtruje sum po statusie — bierze wynik `GET /subscriptions/totals` (`frontend-subtracker/src/app/subscriptions/cost-totals.store.ts`; kontrakt w komentarzu `subscription.types.ts:55-58`).
- Frontend `relativeDays()` zwraca `null` dla dnia z przeszłości z jawnym komentarzem, że job S-05 może jeszcze nie przesunąć subskrypcji (`subscription-labels.ts:60-71`) — ślad oczekiwanego opóźnienia joba.

### Frontend: formularz, lista, dialogi

- Typ i etykiety: `subscription.types.ts:4`; `subscription-labels.ts:11-16` (Trial / Aktywna / W trakcie anulowania / Anulowana), dopiski dat `:46-51`, `referenceDate()` `:55-59`.
- Formularz: status domyślnie `active` (`subscription-form.ts:121`), opcje z `keysOf(STATUS_LABELS)` (`:168`, `subscription-form.html:108-115`) — w edycji dowolne przejście, także `cancelled → active`. Pole końca triala tylko dla triala (`ts:122-125,172-178`; `html:117-131`). Czyste funkcje żądań: `subscriptions/subscription-request.ts:25-70`.
- Tabela: status jako kolorowany tekst (`subscription-table.html:46-57,147-149`; kolory `subscription-table.scss:91-109`, tokeny `styles/_theme.scss:159-162`). Akcje wiersza tylko Edytuj/Usuń (`html:92-122,186-208`). `today` ustalane raz przy tworzeniu komponentu (`subscription-table.ts:64-65`).
- Wzorzec dialogu do potwierdzenia akcji: `delete-subscription-dialog.ts:30-98` (alertdialog, fokus na „Anuluj”, dialog sam wysyła żądanie, wynik `'deleted' | 'missing' | undefined`); obsługa po stronie strony `pages/subscriptions/subscriptions.ts:256-278` (zamknięcie panelu, fokus, komunikat, `load(true)`, `totals.refresh()`). Tekst dialogu odsyła do zmiany statusu (`delete-subscription-dialog.html:7-11`) — S-05 musi go zaktualizować, jeśli anulowanie dostanie własną akcję.
- Daty: `shared/date-only.ts:9-37` — „dziś” to lokalny dzień przeglądarki; `daysFromToday` porównuje północe UTC z lokalnych części daty. Zestaw frontu biegnie w `Europe/Warsaw` i `America/New_York` (`context/foundation/test-plan.md:122`).

### Scheduler, czas i proces

- Brak `@nestjs/schedule` (`backend-subtracker/package.json`, sekcja dependencies) i brak jobów w `src/` (grep po `Cron`, `Interval`, `setInterval`, `setTimeout`).
- Brak ustawienia strefy: `env.ts:6-36` (żaden klucz czasu), `database.options.ts:99-142` (połączenie, pula, `statement_timeout`), `start-app.sh:22-44` (env tylko z `.env`, bez `TZ`). Testy backendu (vitest) bez `TZ`; CI runner w UTC (`context/archive/2026-11-13-frontend-unit-tests/research.md:53`).
- Proces: jedna instancja `forever --uid subtracker-api` (`start-app.sh:32-44`); `start-app.sh:20` zawsze najpierw woła `stop-app.sh`; deploy: stop → `pg_dump` → migracje → swap → health-check (`deploy/mydevil/README.md:75-86`; `deploy.sh:103-106`); `@reboot` → `start-all.sh` z `sleep 30` (`README.md:158`). Wniosek (nie stwierdzony wprost w dokumentach): w sprawdzonych skryptach nie ma ścieżki uruchamiającej dwa procesy API naraz, więc cron w procesie nie powinien biec podwójnie; start może jednak nastąpić o dowolnej minucie.
- Rollback API przywraca dump sprzed deployu (`README.md:97`) — przejścia wykonane po deployu znikają, job nadrabiający je powtórzy.
- Brak monitoringu (`context/foundation/infrastructure.md:67,71`) — cicha awaria joba nie wyjdzie sama.

### Testy dotykające statusu (stan wyjściowy)

- Backend unit: `cost-totals.spec.ts:33-39` (dokładna lista `COUNTED_STATUSES`), `subscription-order.spec.ts:7-24` (mapa grup i dokładny SQL CASE), `create-subscription.dto.spec.ts:37,84-120`.
- Backend e2e: `test/subscriptions/subscriptions.e2e-spec.ts:206-234` (**`PUT` active → cancelled_pending przyjmowany — dowolne przejście**), `:236-252` (trial → active czyści `trialEndDate`), `:254-277` (active → trial wymaga daty); `test/subscriptions/cost-totals.e2e-spec.ts:107-120` (`PUT` → cancelled zdejmuje z sum). Jeśli S-05 ograniczy przejścia w `PUT`, te testy zmienią znaczenie.
- Fikstury e2e mają daty wokół listopada 2026 (np. `trialEndDate: '2026-11-20'`) — po wprowadzeniu joba zależnego od „dziś” zaczną się starzeć; testy joba potrzebują wstrzykiwanego „dziś” zamiast zegara systemowego.
- Frontend: `subscription-form.spec.ts:198-270,474-507`, `subscription-request.spec.ts:58-191`; brak testu `subscription-labels.ts`; e2e przeglądarki seedują tylko `active` (`e2e/browser/subscriptions-flow.e2e-spec.ts:61`, `subscription-edit-delete.e2e-spec.ts:57`).

## Code References

- `backend-subtracker/src/subscriptions/entities/subscription.entity.ts:59-69` — status i daty
- `backend-subtracker/src/subscriptions/subscription.types.ts:2-7` — enum statusów
- `backend-subtracker/src/subscriptions/dtos/create-subscription.dto.ts:24-86` — reguły dat i statusu (POST i PUT)
- `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:40-57,108-110,138-160` — pola, filtr sum, update
- `backend-subtracker/src/subscriptions/cost-totals.ts:10-18` — `COUNTED_STATUSES`
- `backend-subtracker/src/subscriptions/subscription-order.ts:5-36` — kolejność listy
- `backend-subtracker/src/database/migrations/1794406389791-SubscriptionsSchema.ts:14-29` — schemat i indeksy
- `backend-subtracker/src/shared/validation/date-only.ts:7-33` — walidator dnia
- `backend-subtracker/src/app.module.ts:16-48` — moduły (bez schedulera)
- `frontend-subtracker/src/app/subscriptions/subscription-labels.ts:11-89` — etykiety, dopiski, `relativeDays`
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:121-192` — wybór statusu
- `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/` — wzorzec dialogu i tekst o anulowaniu
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:256-278` — obsługa akcji wiersza po dialogu
- `deploy/mydevil/start-app.sh:18-44`, `deploy/mydevil/README.md:75-97,158` — proces, deploy, rollback, `@reboot`

## Architecture Insights

- Statusy to `varchar` + enum TS w module funkcji (`context/foundation/backend-patterns.md:97-98`); daty to `date` jako string `YYYY-MM-DD` bez `Date` — porównania „dziś” najprościej robić na stringach dnia albo w SQL na `date`.
- Listy statusów są włączające (`COUNTED_STATUSES`) — nowy status nie trafi sam do sum; przejścia nie wymagają zmiany sum.
- Lekcje wiążące dla joba: idempotencja + nadrabianie zaległych + trwały znacznik w bazie; indeks na kolumnach, po których job filtruje (status, daty) — ale tylko taki, którego zapytanie używa; schemat zmienia wyłącznie migracja wygenerowana na koniec slice'u.
- Nowy endpoint (np. anulowanie) w API wymaga wpisu w strażniku tras `routes.e2e-spec.ts` (`EXPECTED_ROUTES`) i testu dwóch kont (`test-plan.md:145-160`, §6.4).
- Frontend nie potrzebuje nowej trasy na anulowanie — akcja wiersza + dialog wg wzorca usuwania; po akcji `load(true)` i `totals.refresh()`.

## Historical Context (from prior changes)

- `context/archive/2026-11-11-first-subscription-in-list/plan-brief.md:24-25`, `plan.md:34,81,92-93,165` — 4 statusy do wyboru przy dodawaniu (historia pod statystyki), reguły dat „żeby S-05 i S-06 miały zawsze datę do pracy”, automatyczne przejścia odłożone do S-05/S-06. *Nadal zgodne z kodem.*
- `context/archive/2026-11-11-first-subscription-in-list/research.md:50` — joby S-05 idempotentne i nadrabiające; strefa pozostawiona otwarta. *Nadal otwarte.*
- `context/archive/2026-11-15-edit-and-delete-subscription/plan.md:46`, `plan-brief.md:24,68` — edycja przyjmuje każdy status, „maszyna stanów zostaje w S-05”, „S-05 może później ograniczyć zmiany statusu i zmienić kontrakt `PUT`”. *Zgodne z kodem; decyzja przekazana do S-05.*
- `context/archive/2026-11-15-dashboard-cost-totals/plan.md:21,85`, `plan-brief.md:68` — `cancelled_pending` liczy się w sumach (pełny rok w sumie rocznej); „po S-05 zawyżenie trwa najwyżej do daty rozliczenia”. *Zgodne; S-05 to ograniczenie realizuje.*
- `context/archive/2026-11-03-magic-link-sign-in/plan.md:45,447` — sprzątanie wygasłych `magic_link_token` i starych `session` „gdy pojawi się scheduler”, przypisane do S-05. *Nadal nie zrobione; wybór zakresu dla planu.*
- `context/archive/2026-10-16-production-database-wiring/plan.md:71` — joby stają w czasie deployu i muszą nadrabiać. *Zgodne z lekcją.*
- `context/foundation/test-plan.md:213,225` — §7: testy jobów wejdą z S-05/S-06; §8: po S-05 `--refresh` (nowe ryzyko top-3). §2/§3/§6 nie mają wpisu o jobach ani o czasie po stronie backendu.

## Related Research

- `context/archive/2026-11-11-first-subscription-in-list/research.md`
- `context/archive/2026-11-15-edit-and-delete-subscription/research.md`
- `context/archive/2026-11-15-dashboard-cost-totals/research.md`
- `context/archive/2026-11-13-frontend-unit-tests/research.md` (strefy czasowe w testach frontu)

## Open Questions

Wybory produktowe (owner: użytkownik) — do rozstrzygnięcia w `/10x-plan`:

1. **Przejścia użytkownika.** Czy anulowanie to osobna akcja (`active`/`trial` → `cancelled_pending`), czy dalej edycja statusu? Czy wolno cofnąć anulowanie (`cancelled_pending → active`)? Czy `PUT` zachowuje swobodny wybór statusu (korekta pomyłek wg FR-005), czy dostaje reguły przejść — to zmienia testy e2e `subscriptions.e2e-spec.ts:206-277` i formularz.
2. **Strefa „dziś”.** `Europe/Warsaw` (rekomendacja `infrastructure.md:76,102`) liczona w procesie (`timeZone` w `@Cron` + jawna data dnia), czy `CURRENT_DATE` w Postgresie (zależny od nieudokumentowanej strefy sesji na MyDevil)? Strefa procesu i bazy na MyDevil — do sprawdzenia na serwerze.
3. **Granica dnia przejścia.** „Po dacie końca triala” / „po dacie rozliczenia”: przejście w dniu daty czy dzień później (`<` vs `<=` względem „dziś”)? PRD mówi „po dacie”, a `cancelled_pending` to „koniec opłaconego okresu”.
4. **`active` z `next_billing_date` w przeszłości.** Przesuwać datę o cykl (monthly/yearly) czy zostawić? Nigdzie nie wspomniane; dotyczy kolejności listy i S-06 (pośrednio). Poza FR-013 — kandydat na świadome wyłączenie z zakresu.
5. **Kiedy job biegnie.** Cron (np. raz dziennie w nocy) + przebieg przy starcie procesu, żeby nadrobić okno deployu/restartu? Przejścia stanu są idempotentne same z siebie (warunek na status i datę w `UPDATE … WHERE`), więc znacznik wykonania może nie być potrzebny — w odróżnieniu od e-maili S-06.
6. **Sprzątanie tokenów i sesji** z S-01 — w S-05 czy osobno?
7. **Testy.** Brak przepisu §6 na testy czasu po stronie backendu; potrzebny wstrzykiwany zegar/„dziś” i decyzja o warstwie (unit funkcji przejść + e2e na bazie). Po S-05: `/10x-test-plan --refresh`.
