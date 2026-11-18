<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Limity budżetu i alerty 80% / 100% (S-08)

- **Plan**: context/changes/budget-limits-and-alerts/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-18
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 8 observations

Faza 4 objęta przeglądem mimo otwartego 4.2 — ten punkt („dokumenty zgodne z kodem”) jest wykonywany właśnie przez ten przegląd. Kryteria automatyczne uruchomione 2026-11-18: backend `migration:show` (BudgetLimits zastosowana), `migration:generate -- Check` („No changes”), `lint` (exit 0, ostrzeżenia tylko w `roles.guard.spec.ts` sprzed S-08), `build`, `npm test` 426/426, `test:e2e` 145/145; frontend `test:ci` 508 × 2 strefy, `build` bez ostrzeżeń, `build:e2e && e2e` 14/14; `npm run format` w backendzie bez zmian treści.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Karty /dashboard bez limitu nie pokazują „—”

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/pages/dashboard/dashboard.html (blok kart, `@if (limitNote(item); as limit)`)
- **Detail**: Plan: „Tabela i karty: kolumny „Limit” (kwota albo „—”)”. Tabela pokazuje „—”, karta na telefonie dla kategorii bez limitu nie pokazuje nic (test „shows the limit and its state on a phone card only for a category with a limit” utrwala to zachowanie). Odchylenie nieudokumentowane.
- **Fix**: Uznać za zamierzone (karta bez pustych linii) i dopisać do Notes w change.md — albo dodać linię „Limit: —” w karcie.
- **Decision**: FIXED (Fix differently) — po obejrzeniu „—” usunięte także z tabeli: bez limitu komórki „Limit” i „Limit — status” są puste, a karta nie ma linii limitu

### F2 — Pasek limitu zduplikowany w kolumnie sum i na /dashboard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/dashboard/dashboard.html + .scss; frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.html + .scss
- **Detail**: Logika jest wspólna (`budgetBar()` w `subscription-labels.ts`), ale znaczniki paska (role="progressbar", aria-*, wypełnienie, tekst wykorzystania, opis z ikoną) i ok. 50 linii SCSS są skopiowane, różnią się tylko kolorami i wysokością. Kontrakt ARIA może się rozjechać przy kolejnej zmianie.
- **Fix A ⭐ Recommended**: Wydzielić mały komponent `app-budget-bar` (wejście: `BudgetBar`, kolory z tokenów `--st-alert-*` rodzica, jak `app-duplicate-warning-icon`)
  - Strength: Jedno miejsce znaczników i ARIA; ten sam wzorzec co wspólna ikona z S-07, kolory już są remapowane przez zmienne na `:host` kolumny.
  - Tradeoff: Nowy komponent + przeniesienie testów paska; dotyka dwóch zatwierdzonych widoków tuż przed PR.
  - Confidence: MED — remapowanie tokenów na granacie działa dziś przez CSS variables, komponent je odziedziczy, ale wysokość/odstępy trzeba przenieść jako wariant.
  - Blind spot: Nie sprawdzono, czy testy kolumny/dashboardu nie polegają na klasach `totals__budget-*` / `dashboard__budget-*`.
- **Fix B**: Zostawić duplikat i zanotować jako dług do S-10/kolejnego slice'a dotykającego paska
  - Strength: Zero ryzyka przed merge; oba widoki już ręcznie przetestowane.
  - Tradeoff: Duplikat zostaje; przy zmianie paska trzeba pamiętać o dwóch miejscach.
  - Confidence: HIGH — kod działa i jest pokryty testami w obu miejscach.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix differently) — wspólny partial SCSS paska zamiast komponentu, znaczniki bez zmian

### F3 — /dashboard bez liczonych subskrypcji nie pokazuje karty limitu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/pages/dashboard/dashboard.html (gałąź `@else if (current.totals.categories.length === 0)`)
- **Detail**: Stan pusty jest przed blokiem sum i limitu, więc bez subskrypcji nie widać ani limitu, ani „Brak limitu. Ustaw limit”. Plan tego przypadku nie opisuje; wydatki 0 zł i tak nigdy nie dają alertu.
- **Fix**: Uznać za zamierzone i dopisać do Notes w change.md.
- **Decision**: FIXED — karta limitu widoczna także w stanie pustym

### F4 — Limetkowe wypełnienie paska na jasnym tle ma niski kontrast

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/dashboard/dashboard.scss (pasek), frontend-subtracker/src/styles/_theme.scss (`--st-lime`)
- **Detail**: Poniżej 80% pasek na /dashboard to `#D6F25E` na jasnym torze (`--st-line`) na białym — ok. 1,2–1,4:1 (WCAG 1.4.11 zaleca 3:1). Informację niesie tekst „X z Y zł (N%)”, a użytkownik w teście ręcznym fazy 3 uznał wypełnienie za wystarczające.
- **Fix**: Zaakceptować (decyzja z testu ręcznego) albo na jasnym tle użyć ciemniejszego tokenu wypełnienia.
- **Decision**: FIXED (Fix differently) — jeden kolor limetki #B8D435 (o odcień ciemniejszy niż #D6F25E z F2) na jasnym tle i na granatowej kolumnie; ocena wizualna użytkownika zamiast progu 3:1

### F5 — Lokalne helpery kwot w budget.ts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/budget/budget.ts:76 (`amountGrosze`), :92 (`limitText`)
- **Detail**: Ogólne przeliczenia (liczba → grosze, kwota z API → tekst pola) są prywatne w stronie; `limitText` powtarza `replace('.', ',')` z `subscriptions/subscription-request.ts:63`. Lekcja „Kod ogólny w `shared/`”.
- **Fix**: Przenieść oba do `shared/grosze.ts` (z testem) i użyć w `subscription-request.ts`.
- **Decision**: FIXED — helpery kwot przeniesione do shared/ z testami

### F6 — `typedLimit(...) ?? null` usunąłby limit przy niepoprawnej wartości

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/budget/budget.ts:106, :117
- **Detail**: Niepoprawny wpisany limit zamienia się na `null` (usunięcie zapisanego limitu). Dziś `submit()` kończy się wcześniej przy `form.invalid`, więc to nieosiągalne — zależność jest jednak niejawna.
- **Fix**: Komentarz przy `budgetChanges` mówiący, że wywołuje się ją tylko dla poprawnego formularza.
- **Decision**: FIXED — komentarz przy budgetChanges

### F7 — Komentarz klasy BudgetController opisuje tylko progi

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/subscriptions/controllers/budget.controller.ts:8
- **Detail**: Komentarz nadal mówi tylko o „the duplicate threshold per category (S-07)”.
- **Fix**: Dopisać limity miesięczne (S-08).
- **Decision**: FIXED — komentarz klasy z limitami S-08

### F8 — Brak e2e dla samego limitu w cudzej kategorii

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: backend-subtracker/test/subscriptions/budget.e2e-spec.ts:337
- **Detail**: Test „refuses to save another account's category” wysyła próg; pozycja z samym `monthlyLimit` dla cudzej kategorii przechodzi przez to samo sprawdzenie, ale nie jest przypięta testem (ryzyko #1 test-planu: izolacja kont).
- **Fix**: Dodać wariant `it.each` z `{ categoryId, monthlyLimit: 10 }` oczekujący 400 i braku zapisu.
- **Decision**: FIXED — wariant e2e z samym limitem w cudzej kategorii

### F9 — „jeden odczyt” w backend-patterns.md

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/backend-patterns.md („Ustawienia budżetu”)
- **Detail**: Dokument mówi „Ustawienia obu tabel czyta jeden odczyt (`BudgetService.budgetSettings`)”, a kod robi dwa zapytania równolegle (`Promise.all`) w jednej metodzie. Reguły w dokumentach poza tym zgodne z kodem (4.2).
- **Fix**: Zmienić na „jedna metoda, dwa równoległe zapytania (`BudgetService.budgetSettings`)”.
- **Decision**: FIXED — „jedna metoda, dwa równoległe zapytania”

### F10 — Dwa sposoby odczytu domyślnego progu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: backend-subtracker/src/subscriptions/services/budget.service.ts:52-60; entities/budget-settings.entity.ts (`defaultDuplicateThresholdOf`, używany w `categories.service.ts`)
- **Detail**: `budgetSettings()` czyta `BudgetSettings` bezpośrednio (potrzebuje też `monthlyLimit`), a `categories.service.ts` dalej używa `defaultDuplicateThresholdOf`. Fallback „brak wiersza = 3” jest w dwóch miejscach.
- **Fix**: Zaakceptować; opcjonalnie oprzeć oba na jednej funkcji zwracającej domyślny próg z wiersza lub stałej.
- **Decision**: FIXED — defaultThresholdOf() przy encji, używana w obu miejscach
