# Follow-up: osobny zapis domyślnych wartości i kategorii na `/budget`

Zgłoszone przez użytkownika podczas testu ręcznego fazy 2 S-17 (2026-11-25); decyzja: osobna, mała zmiana po S-17, nie w tym slice.

- **Cel:** panel „domyślny próg i limit całościowy” ma własne „Zapisz” obok pól (bez przewijania do końca strony), niezależne od „Zapisz” pod listą kategorii.
- **Backend:** bez zmian — `PUT /budget` przyjmuje częściowe zmiany (`categories` opcjonalne).
- **Frontend (`frontend-subtracker/src/app/pages/budget/`):**
  - podział `budgetChanges` (`budget.ts`) na zmiany domyślnych i kategorii, osobny stan obu przycisków;
  - walidacja tylko kontrolek zapisywanego panelu (`submit()` blokuje dziś przy niepoprawnym całym formularzu);
  - po zapisie aktualizacja tylko zapisanej części: dziś `show(response)` przebudowuje cały formularz i wymazałby niezapisany szkic drugiego panelu — główny koszt i ryzyko;
  - wspólny status, 400 przeładowuje wszystko jak dziś;
  - ~8–10 testów w `budget.spec.ts` (zapis jednego panelu zachowuje szkic drugiego, błąd w jednym nie blokuje drugiego).
- **Szacunek:** jeden przebieg implementacji (~100 linii logiki) + bramki + test ręczny; ryzyko średnie (zachowanie szkicu).
