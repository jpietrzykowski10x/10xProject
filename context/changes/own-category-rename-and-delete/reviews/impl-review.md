<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Zmiana nazwy i usuwanie własnych kategorii

- **Plan**: context/changes/own-category-rename-and-delete/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Przegląd zgodności z planem: wszystkie zmiany faz 1–3 są zgodne z planem (MATCH). Brak pozycji DRIFT i MISSING. Rozszerzenia zakresu zatwierdzone przez użytkownika są spójne i opisane w `change.md`: panel „Nowa kategoria”, trzy panele, dłuższy limit czasu w `access-log.e2e-spec.ts`.

Bramki uruchomione na `main` po merge'u (c3e92c8):
- backend: 790 testów jednostkowych, lint 0 błędów, build OK;
- frontend: `test:ci` 669 × 2 strefy czasowe;
- e2e API i przeglądarki: zielone w CI na PR #84.

Kontrole ręczne 1.7, 2.4, 2.5 i 3.3 są potwierdzone przez użytkownika.

## Findings

### F1 — Dodanie kategorii przeładowuje formularz i gubi zmiany wpisane w trakcie żądania

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/budget/budget.ts:398-429 (oraz budget.html:154)
- **Detail**:
  - „Dodaj” sprawdza `changes() === null` tylko w chwili kliknięcia. Podczas `POST /categories` pola progów i limitów nadal można edytować.
  - Po 201 `load()` przebudowuje formularz i bez komunikatu kasuje to, co wpisano w tym czasie.
  - „Zapisz” jest wyłączony tylko przy `sending() || changes() === null`. Kliknięty w tym oknie wysyła `PUT /budget`, który ściga się z `GET` przeładowania.
  - Okno ma długość jednego żądania, więc trafienie jest mało prawdopodobne, ale skutek to cicha utrata danych.
- **Fix**: Na czas `addingCategory()` wyłączyć formularz budżetu: `form.disable()` albo warunek w `[disabled]` przycisku „Zapisz” i w polach, tak jak przy `sending`. Do tego test w `budget.spec.ts`.
  - Strength: Jedna flaga, która już istnieje. Zachowanie zgodne z blokadą ikon przy niezapisanych zmianach.
  - Tradeoff: Pola na chwilę szarzeją przy dodawaniu kategorii.
  - Confidence: HIGH. Przebieg potwierdzony w kodzie.
  - Blind spot: Nie sprawdzono, czy `form.disable()` nie zmienia `changes()` (wartości wyłączonych kontrolek).
- **Decision**: FIXED — „Dodaj” był już wyłączony przy niezapisanych zmianach; dodatkowo w trakcie dodawania formularz budżetu i „Zapisz” są wyłączone (`budget.ts`, `budget.html`), test w `budget.spec.ts`, celowe uszkodzenie czerwieni test.

### F2 — Luki w testach: `disableClose` w trakcie żądania

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: frontend-subtracker/src/app/pages/budget/rename-category-dialog/rename-category-dialog.spec.ts, delete-category-dialog/delete-category-dialog.spec.ts
- **Detail**:
  - Plan wymaga, żeby dialog miał `disableClose` w trakcie żądania. Kod to robi, ale żaden spec tego nie sprawdza; wzorzec `delete-subscription-dialog` też nie.
  - Prawdziwe wyścigi blokad (dwa połączenia) są pokryte tylko przez mock `EntityManager.exists`. Plan dopuszczał takie podejście, więc to nie jest odchylenie.
- **Fix**: W obu specach dodać przypadek: w trakcie żądania `dialogRef.disableClose === true`, po błędzie wraca `false`.
- **Decision**: FIXED — test „Escape ignorowany w trakcie żądania, działa po błędzie” w obu dialogach; celowe uszkodzenie `disableClose` czerwieni test.

### F3 — Zmiana nazwy cudzej albo predefiniowanej kategorii na zajętą nazwę daje 409 zamiast 404

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: backend-subtracker/src/subscriptions/services/categories.service.ts:116
- **Detail**:
  - `nameTaken` sprawdza nazwę przed `update({ id, userId })`. `PATCH` na id predefiniowanej albo cudzej kategorii z nazwą, którą wywołujący już ma, zwraca więc 409, a kontrakt w komentarzu kontrolera mówi 404.
  - Nic nie wycieka, bo sprawdzane są tylko kategorie własne i predefiniowane. To niespójność kontraktu bez testu.
- **Fix**: Dopisać kolejność do komentarza. Opcjonalnie można najpierw sprawdzić własność, ale to dodatkowe zapytanie.
- **Decision**: FIXED (decyzja użytkownika: edytować można tylko własne) — `rename` najpierw sprawdza własność (`exists({ id, userId })` → 404), dopiero potem nazwę; e2e w `account-isolation.e2e-spec.ts`: 404 dla cudzej i predefiniowanej mimo zajętej nazwy, nazwa używana przez inne konto wolna przy zmianie nazwy; celowe uszkodzenie czerwieni test.

### F4 — Gałąź 23503 na `CATEGORY_SETTING_CATEGORY_FK` w `remove` mówi „ma subskrypcje”

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/categories.service.ts:154,160
- **Detail**:
  - `category_setting` jest usuwany z filtrem `{ userId, categoryId }`. 23503 na tym FK wymagałby wiersza ustawień innego użytkownika dla tej kategorii, a API takiego nie tworzy.
  - Gałąź jest praktycznie nieosiągalna, a gdyby zadziałała, komunikat „The category has subscriptions” byłby nieprawdziwy.
- **Fix**: Usuwać ustawienia po samym `categoryId`, bo kategoria jest już potwierdzona jako własna pod blokadą. Wtedy gałąź `CATEGORY_SETTING_CATEGORY_FK` w `remove` można usunąć; wystarczy ją zostawić jako zabezpieczenie.
- **Decision**: FIXED — `category_setting` usuwany po samym `categoryId`, gałąź `CATEGORY_SETTING_CATEGORY_FK` usunięta z `remove` (nadal mapowana w `PUT /budget`).

### F5 — Ponowna walidacja pola „Nowa kategoria” zależy od efektu ubocznego `enable()`/`disable()`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/budget/budget.ts:308-316
- **Detail**:
  - Błąd „zajęta nazwa” odświeża się po przeładowaniu listy tylko dlatego, że `enable()` i `disable()` wewnętrznie wołają `updateValueAndValidity`.
  - „Optymalizacja” efektu, która woła je tylko przy zmianie stanu, zostawi nieaktualny błąd.
- **Fix**: W efekcie jawnie wołać `this.newCategoryName.updateValueAndValidity({ emitEvent: false })`.
- **Decision**: FIXED — jawne `updateValueAndValidity({ emitEvent: false })` w efekcie.

### F6 — Drobne luki w dokumentach zmiany

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/own-category-rename-and-delete/change.md:14, CLAUDE.md:34
- **Detail**:
  - Notes w `change.md` opisują „Nową kategorię” jako „wiersz pod listą kategorii”; w rzeczywistości to osobny panel pod formularzem. Notes nie opisują też układu trzech paneli ani dłuższego limitu czasu w `access-log.e2e-spec.ts` (ten jest w wiadomości commita 0b198e6).
  - `CLAUDE.md` nie wspomina o dodawaniu kategorii na `/budget`, które opisuje już `backend-patterns.md`.
  - Dodatkowo, poza tym ustaleniem: dialog zmiany nazwy nie sprawdza zajętej nazwy po stronie klienta, a panel dodawania to robi. Tytuł dialogu usuwania nie ma cudzysłowów „”, które ma dialog usuwania subskrypcji.
- **Fix**: Poprawić zdanie w Notes `change.md`, dopisać trzy panele i limit czasu testu, a w `CLAUDE.md` dodać „dodawanie kategorii w panelu »Nowa kategoria«”.
- **Decision**: FIXED — `change.md` Notes (osobny panel, trzy panele, limit czasu testu logu dostępu), `CLAUDE.md` (dodawanie na `/budget`), `backend-patterns.md` (kolejność w `rename`, usuwanie ustawień, blokada formularza przy dodawaniu).
