# Automatyczny cykl życia subskrypcji (S-05) — Plan Brief

> Full plan: `context/changes/subscription-lifecycle/plan.md`
> Research: `context/changes/subscription-lifecycle/research.md`

## What & Why

Użytkownik anuluje subskrypcję jedną akcją, a system sam prowadzi ją przez stany: trial → active po końcu triala, cancelled_pending → cancelled po dacie rozliczenia (FR-013). Bez tego status jest zwykłym polem, sumy zawyżają anulowane usługi bez końca, a S-06 (przypomnienia) nie ma na czym stanąć.

## Starting Point

Status to wolne pole edytowane w formularzu; brak akcji „anuluj”, brak schedulera i brak pojęcia „dziś” po stronie backendu. Proces API to jedna instancja na MyDevil, zatrzymywana przy deployu i restartowana w dowolnej chwili.

## Desired End State

W wierszu listy jest „Anuluj subskrypcję” (z dialogiem) i „Przywróć” dla anulowanych w trakcie okresu. Codziennie o 00:05 (Europe/Warsaw) i przy każdym starcie API job przenosi zaległe triale i anulowania oraz przesuwa nieaktualne daty rozliczeń aktywnych subskrypcji; ten sam scheduler sprząta stare tokeny i sesje. Edycja nadal pozwala ręcznie poprawić status i daty.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Anulowanie | Osobna akcja w wierszu + dialog, `POST /subscriptions/:id/cancel` | Oddziela rezygnację od usunięcia (FR-006) na sprawdzonym wzorcu dialogu. | Plan |
| Cofnięcie anulowania | Akcja „Przywróć”, `POST …/resume`, bez dialogu | Jak w realnych usługach; naprawia pomyłkowe kliknięcie. | Plan |
| Edycja (`PUT`) | Pełna, dowolny status i daty (bez zmian kontraktu) | Pokrywa zawieszenie i wznowienie z nowymi datami; brak okna niezgodności przy deployu. | Plan (zmiana po namyśle) |
| Anulowanie triala | Rozliczenie := koniec triala, koniec triala := null | Anulowany trial nie przechodzi w płatny okres. | Plan |
| „Dziś” | Dzień w Europe/Warsaw liczony w procesie, przekazywany do SQL | Niezależne od nieznanej strefy procesu i bazy na MyDevil; łatwe do testu. | Plan (rekomendacja `infrastructure.md`) |
| Granica dnia | Przejście dzień po dacie (`data < dziś`) | Dosłownie „po dacie” z FR-013. | Plan |
| Active z przeszłą datą | Job przesuwa o cykl aż ≥ dziś, przycięcie końca miesiąca | Bez tego listy, dopisek „za N dni” i S-06 pracują na nieaktualnych datach. | Plan |
| Harmonogram | Cron 00:05 + przebieg przy starcie (awaitowany, `try/catch`) | Nadrabia okno deployu i restartu (lekcja o zadaniach cyklicznych). | Research + Plan |
| Idempotencja | Warunek status + data w `UPDATE`, bez znacznika wykonania | Przejścia stanu są idempotentne same; znacznik dopiero dla maili S-06. | Research |
| Sprzątanie tokenów/sesji | W S-05, osobny job w module auth, retencja 7 dni | Zamyka follow-up z S-01 tanim kosztem, scheduler i tak powstaje. | Plan |
| Testy czasu | Unit z wstrzykniętym „dziś”; e2e z prawdziwym „dziś” i datami względem niego | Job działa na całej bazie dev, „dziś” z przyszłości zepsułoby dane ręcznych testów. | Plan |

## Scope

**In scope:** trasy cancel/resume; job cyklu życia (3 reguły); job sprzątania; `@nestjs/schedule`; helpery dnia w `shared/date/`; 5 indeksów w jednej migracji; akcje i dialog na froncie; testy unit, e2e API, komponentów, Playwright; `backend-patterns.md`, cookbook §6, CLAUDE.md, README deployu.

**Out of scope:** ograniczanie edycji; status „zawieszona”; wznawianie `cancelled` akcją; historia przejść; maile (S-06); strefa per użytkownik; blokada joba między procesami; monitoring; zachowanie dnia kotwicy przy przesuwaniu dat.

## Architecture / Approach

Reguły przejść to czyste funkcje w module `subscriptions` (testowane z dowolnym „dziś”), ogólne funkcje dnia w `shared/date/`. Serwisy wykonują warunkowe `UPDATE`-y (akcje ograniczone do konta, job na wszystkich kontach); schedulery (`onApplicationBootstrap` + `@Cron` z `timeZone`) tylko wyliczają „dziś” i wołają serwisy. Front: tabela emituje akcje, strona obsługuje wynik jak po usunięciu (komunikat, `load(true)`, `totals.refresh()`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API — anuluj i przywróć | Dwie trasy z 404/409, testy dwóch kont | Rozróżnienie 404 vs 409 bez wyścigu |
| 2. Scheduler i job cyklu życia | Przejścia i przesuwanie dat, start + cron | Strefa/DST i arytmetyka końca miesiąca |
| 3. Sprzątanie tokenów i sesji | Drugi job, migracja z 5 indeksami | Usunięcie aktywnej sesji przez zły warunek |
| 4. Frontend — akcje | Anuluj (dialog) i Przywróć w wierszu, Playwright | Poziomy scroll tabeli i nadpisanie przez otwartą edycję |
| 5. Dokumentacja i cookbook | Przepis na joby i testy czasu dla S-06 | — |

**Prerequisites:** S-02–S-04 na main (spełnione); lokalny Postgres i `.env` z `MODE=DEV`; Node 24.
**Estimated effort:** ~2 sesje (fazy 1–3 backend, 4–5 front i dokumenty), waga 9 w ocenie postępu.

## Open Risks & Assumptions

- Pierwszy start po deployu wykona wszystkie zaległe przejścia na produkcji naraz (np. daty active sprzed tygodni) — zamierzone, ale warto zajrzeć do logu.
- Zakładamy jedną instancję API (`start-app.sh` zatrzymuje poprzednią); dwa procesy dałyby podwójny przebieg, który i tak jest idempotentny.
- Brak monitoringu: cicha awaria joba wyjdzie tylko w logu (`err.log`).
- Po S-05 `test-plan.md` §8 przewiduje `/10x-test-plan --refresh` (nowe ryzyko czasu).

## Success Criteria (Summary)

- Anulowanie i przywrócenie działa jednym kliknięciem; anulowany trial kończy się z końcem triala.
- Dzień po dacie końca triala lub rozliczenia status zmienia się sam, także gdy API było w tym czasie zatrzymane; anulowana subskrypcja znika z sum.
- Daty rozliczeń aktywnych subskrypcji nigdy nie zostają w przeszłości dłużej niż do najbliższego przebiegu joba.
