<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Automatyczny cykl życia subskrypcji (S-05)

- **Plan**: context/changes/subscription-lifecycle/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-11-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated verification (2026-11-16)

- backend `npm test`: 24 plików, 263 testy, wszystkie zielone
- backend `npm run lint`: brak błędów; ostrzeżenia `unbound-method` tylko w `roles.guard.spec.ts` (sprzed tej zmiany)
- backend `npm run build`: OK
- backend `npm run migration:show`: `LifecycleJobIndexes1794817426212` zastosowana na `subtracker-db`
- backend `npm run migration:generate -- Check`: „No changes in database schema were found”
- backend `npm run test:e2e`: 15 plików, 109 testów, wszystkie zielone
- frontend `npm run test:ci`: 29 plików, 351 testów, zielone w obu strefach
- frontend `npm run build`, `npm run build:e2e`: OK
- frontend `npm run e2e`: 14/14 zielone, w tym `subscription-cancel.e2e-spec.ts`

Odchylenie od planu, uzasadnione: e2e joba nie sprawdza, że drugi `advance` „zwraca same zera”. Liczniki obejmują całą bazę dev, więc test porównuje wiersze własnego konta przed i po drugim przebiegu. Uzasadnienie opisano w test-plan §6.4.

## Findings

### F1 — Akcja wykonana w trakcie zapisu edycji zostawia w panelu formularz ze starym statusem

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:345 (`afterLifecycleAction`), :221 (`close`)
- **Detail**: Przy szerokości ≥1200 px lista obok panelu edycji nie jest `inert`, więc akcje w wierszu dalej da się kliknąć. Scenariusz: trwa zapis edycji subskrypcji X, a użytkownik anuluje albo przywraca X. Wtedy `close()` kończy działanie od razu, bo `formSending()` ma wartość true. Panel zostaje otwarty z formularzem, który trzyma stary status, a kolejne „Zapisz” (pełny `PUT`) po cichu cofa akcję. Przed tym właśnie ma chronić zasada z planu („Edycja otwarta dla subskrypcji, którą właśnie anulowano lub przywrócono, zamyka się”). `confirmRemove` (:274) ma tę samą lukę, ale tam skutek jest łagodniejszy: zapis kończy się 404. Okno jest wąskie, bo trwa tylko na czas żądania `PUT`.
- **Fix A ⭐ Recommended**: Gdy `formSending()` i `editing()?.id === subscription.id`, nie uruchamiać akcji (ukryć albo wyłączyć „Anuluj subskrypcję”/„Przywróć” w wierszu edytowanej subskrypcji na czas zapisu).
  - Strength: Usuwa wyścig u źródła, bez nowego stanu do zarządzania. Ta sama blokada pasuje do usuwania.
  - Tradeoff: Tabela potrzebuje informacji, który wiersz jest zapisywany (nowe wejście albo zastosowanie istniejącego `resumingId` w podobny sposób).
  - Confidence: MED — wymaga zmiany w tabeli i stronie oraz testu komponentu.
  - Blind spot: Nie sprawdzono, czy na telefonie lista nie jest już ukryta podczas edycji (wtedy problem występuje tylko na desktopie).
- **Fix B**: Zapamiętać „zamknij po zapisie” i zamknąć panel, gdy zapis się skończy (sukces albo błąd).
  - Strength: Akcja w wierszu nie jest blokowana.
  - Tradeoff: Wynik zapisu (`PUT`) może nadpisać akcję, jeśli dotrze później. Kolejność żądań nie jest gwarantowana.
  - Confidence: LOW — nie usuwa wyścigu po stronie serwera.
  - Blind spot: Kolejność zapisów `PUT` i `POST …/cancel` na serwerze.
- **Decision**: FIXED (Fix A) — strona ma `savingId` (id edytowanej subskrypcji w trakcie zapisu) z zabezpieczeniem w `confirmCancel`, `resume` i `confirmRemove`. Tabela ma wejście `savingId`, które wyłącza w tym wierszu Anuluj, Przywróć i Usuń (desktop i telefon). Dodano testy w `subscription-table.spec.ts` i `subscriptions.spec.ts`.

### F2 — Przesuwanie dat rozliczeń: N+1 zapytań i blokowanie startu przy dużych zaległościach

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/subscription-lifecycle.service.ts:55-93; subscription-lifecycle.scheduler.ts:21 i auth-cleanup.scheduler.ts:21
- **Detail**: Przebieg czyta wszystkie zaległe wiersze `active` bez limitu (`getMany()`), a potem wysyła osobny `UPDATE` dla każdego wiersza. Przebieg przy starcie jest awaitowany przed `listen`, więc duża zaległość (pierwszy start po deployu, przywrócenie z dumpu) opóźnia odpowiedź `/health` podczas health-checku deployu. Przy skali MVP to zgodne z planem („Performance Considerations”) i poprawne, bo przerwany przebieg dokończy następny.
- **Fix**: Zostawić. Przy wzroście danych czytać partiami (`take` z kluczem po `id`) albo wysłać jeden `UPDATE … FROM (VALUES …)` z tymi samymi warunkami.
- **Decision**: SKIPPED — akceptujemy przy skali MVP, zgodnie z „Performance Considerations” planu.

### F3 — Głęboki import typu z typeorm

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/subscriptions/services/subscriptions.service.ts:9
- **Detail**: Plik importuje `QueryDeepPartialEntity` z `typeorm/query-builder/QueryPartialEntity.js`, choć typeorm eksportuje ten typ z głównego modułu (`node_modules/typeorm/index.d.ts:148`). Żaden inny plik w `src/` nie importuje z wnętrza typeorm.
- **Fix**: Zmienić import na `import type { QueryDeepPartialEntity } from 'typeorm'` (albo dołączyć go do istniejącego importu z `typeorm`).
- **Decision**: FIXED — `import { Repository, type QueryDeepPartialEntity } from 'typeorm'`.

### F4 — W trakcie jednego przywracania kliknięcie „Przywróć” w innym wierszu nic nie daje

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:316-318
- **Detail**: Gdy trwa przywracanie jednego wiersza, wyłączony jest tylko przycisk tego wiersza (`resumingId`). Przyciski „Przywróć” w innych wierszach wyglądają na aktywne, ale `resume()` ignoruje kliknięcie bez żadnego komunikatu.
- **Fix**: W tabeli wyłączać każde „Przywróć”, gdy `resumingId() !== null`.
- **Decision**: FIXED — w tabeli każde „Przywróć” jest wyłączone, gdy `resumingId() !== null` (desktop i telefon); zaktualizowano test tabeli.

### F5 — Test strony nie obejmuje wyników `missing` i `conflict` dialogu anulowania

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.spec.ts
- **Detail**: Plan (faza 4, punkt 4) opisuje dla `missing` i `conflict` komunikat oraz odświeżenie listy. Spec strony testuje te ścieżki tylko przy przywracaniu. Spec dialogu sprawdza, że dialog zwraca te wyniki, ale nie sprawdza, jak strona na nie reaguje. Kod korzysta ze wspólnej funkcji `afterLifecycleAction`, więc ryzyko jest małe.
- **Fix**: Dodać do `subscriptions.spec.ts` dwa przypadki: dialog anulowania zwraca `missing` albo `conflict`, a strona pokazuje właściwy komunikat i odświeża listę oraz sumy.
- **Decision**: FIXED — w `subscriptions.spec.ts` dodano `it.each` dla odpowiedzi 404 i 409 na anulowanie: komunikat oraz ponowny odczyt listy i sum.

### F6 — Zmiana w roadmapie spoza planu

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md
- **Detail**: S-05 zmienił status z `proposed` na `in-progress` (w tabeli i w sekcji), a pole `updated` ustawiono na 2026-11-16. To zmiana porządkowa, nieszkodliwa. Inne dodatki spoza planu też są drobne i pomagają: wejście `resumingId`, komunikat `actionError` i `resumeFailedMessage`, mniejsza gęstość przycisków w tabeli (wymóg braku poziomego scrolla), eksporty `CANCELLED_STATUS` i `RESUMED_STATUS`, ochrona przed 404 przy ponownym odczycie oraz usunięcie nieużywanego `STATUS_LABELS` z dialogu usuwania.
- **Fix**: Zostawić. `/10x-archive` (albo zamknięcie slice'u w roadmapie) i tak zmieni status S-05 na `done`.
- **Decision**: SKIPPED — status S-05 zmieni się przy zamknięciu slice'u lub archiwizacji.
