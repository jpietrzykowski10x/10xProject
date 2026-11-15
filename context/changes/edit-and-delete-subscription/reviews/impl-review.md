<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edycja i usuwanie subskrypcji

- **Plan**: context/changes/edit-and-delete-subscription/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-15
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automatyczne kryteria uruchomione ponownie w trakcie przeglądu, wszystkie zielone:
- backend: lint, build, unit (188), test:e2e (87);
- frontend: build, test:ci (308 × 2 strefy), build:e2e, e2e (13).

Wszystkie wiersze Manual w Progress mają `[x]`. Każdy został potwierdzony przez użytkownika w rozmowie albo, w przypadku 1.6, sprawdzony poleceniem.

Zgodność z planem: wszystkie zmiany z Changes Required to MATCH, bez DRIFT i bez MISSING. Pozycje EXTRA zrobione na prośbę użytkownika:
- „Anuluj” w edycji;
- ikony akcji w tabeli;
- tło rozwiniętego wiersza;
- nowe szerokości tabeli;
- równe przyciski dialogu;
- usunięcie wysokości 48 px z motywu.

## Findings

### F1 — Edycja może przywrócić subskrypcję usuniętą w innej karcie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/subscriptions.service.ts:121-128
- **Detail**:
  - `update` odczytuje wiersz przez `findOneBy({ id, userId })`, a zapisuje przez `save(merge(...))` w osobnym kroku.
  - `Repository.save()` szuka wiersza po id i robi INSERT, gdy go nie ma.
  - Jeśli DELETE z innej karty trafi między odczyt a zapis, usunięta subskrypcja wraca z tym samym id.
  - To dokładnie przypadek wielu kart, który frontend obsługuje przez `missing`. Okno jest małe, ale skutek to dane, których użytkownik się pozbył.
- **Fix**: Zapis przez `subscriptions.update({ id, userId }, fields)` i 404, gdy `affected === 0`. Odpowiedź budowana ze scalenia odczytanego wiersza z nowymi polami. Kolejność 404 przed 400 dla kategorii zostaje.
- **Decision**: FIXED — zapis przez update({ id, userId }) z 404 przy affected 0

### F2 — Zamknięcie panelu w trakcie zapisu edycji gubi wynik

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:166,177,198; subscription-form.ts:269-271
- **Detail**:
  - Podczas wysyłania `PUT` wyłączony jest tylko „Anuluj” w formularzu.
  - Panel nadal da się zamknąć albo przełączyć na inny cel:
    - Escape;
    - X „Zamknij panel”;
    - „Dodaj subskrypcję”;
    - przy ≥ 1200 px „Edytuj” innego wiersza.
  - Formularz edycji jest wtedy odmontowany, a `takeUntilDestroyed` porzuca odpowiedź. Serwer może zmianę zapisać, ale nie ma komunikatu ani `load(true)`, więc wiersz na liście pokazuje stare dane do następnego odczytu.
  - Dodawanie tego problemu nie ma, bo jego formularz zostaje zamontowany.
- **Fix A ⭐ Recommended**: Blokować zamknięcie i przełączenie panelu, gdy formularz wysyła. Formularz wystawia stan wysyłania (`sending` output lub sygnał), a strona ignoruje close/open w tym czasie.
  - Strength: Użytkownik zawsze zobaczy wynik zapisu, sukces albo błąd, a lista jest spójna z serwerem.
  - Tradeoff: Nowe połączenie formularz → strona i zmiany w kilku ścieżkach zamykania.
  - Confidence: HIGH — wzorzec „nie zamykaj w trakcie” już działa w dialogu usunięcia (`disableClose`).
  - Blind spot: Przy zawieszonym żądaniu panel nie da się zamknąć aż do błędu lub timeoutu przeglądarki.
- **Fix B**: Każde zamknięcie panelu edycji robi `load(true)`.
  - Strength: Jedna linia, lista zawsze aktualna po zamknięciu.
  - Tradeoff: Brak komunikatu o zapisie albo o błędzie. Dodatkowy `GET` przy każdym zwykłym „Anuluj”.
  - Confidence: MED — `load(true)` może wyprzedzić `PUT` i pokazać stare dane.
  - Blind spot: Kolejność odpowiedzi `PUT` i `GET` nie jest gwarantowana.
- **Decision**: FIXED (Fix A) — formularz wystawia sygnał sending; strona ignoruje close/Escape/toggleAdding/openEdit w trakcie zapisu (dodawanie i edycja); test strony

### F3 — Zmiana wysokości przycisków w całej aplikacji nie jest udokumentowana i jest niespójna

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: frontend-subtracker/src/styles/_theme.scss:~116; frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.scss:42-45
- **Detail**:
  - `context/archive/2026-11-10-ui-foundation/plan.md:83` ustalił `mat-flat-button` na 48 px, na równi z polami 48 px.
  - Usunięcie nadpisania zmniejsza główną akcję na register, sign-in, verify-link, w obu „Dodaj subskrypcję” i w zapisie formularza, nie tylko w tej funkcji. Strona startowa ma własne 52 px.
  - Plan S-03 tego nie przewiduje, choć to była decyzja użytkownika w trakcie fazy 3.
  - Przycisk „Dodaj” własnej kategorii (stroked) jest nadal wymuszony na 48 px („level with the 48px field”). W tym samym formularzu przycisk drugorzędny jest teraz wyższy niż zielona akcja główna, wbrew nowemu komentarzowi w motywie.
- **Fix A ⭐ Recommended**: Zostawić 40 px w całej aplikacji (wybór użytkownika) i zapisać decyzję w Notes `change.md`. Wyjątek 48 px przycisku „Dodaj” kategorii zostaje, bo stoi obok pola 48 px, a komentarz w motywie dostaje to zastrzeżenie.
  - Strength: Zgodne z decyzją użytkownika „oba mniejsze”. Ślad decyzji jest w repo, więc kolejny slice nie przywróci 48 px.
  - Tradeoff: Odchodzi od ustalenia ui-foundation; przyciski główne są niższe niż pola formularza.
  - Confidence: HIGH — użytkownik zaakceptował wygląd po zmianie.
  - Blind spot: Ekranów register, sign-in i verify-link nikt nie obejrzał po zmianie.
- **Fix B**: Przywrócić 48 px w motywie i ustawić 40 px tylko dla par przycisków w dialogu i w panelu edycji.
  - Strength: Decyzja ui-foundation zostaje nienaruszona, a zmiana dotyczy tylko S-03.
  - Tradeoff: Dwie wysokości głównej akcji w aplikacji i lokalne wyjątki w stylach komponentów.
  - Confidence: MED — wymaga nadpisań w dwóch komponentach.
  - Blind spot: Dialog i panel edycji wyglądałyby inaczej niż reszta formularzy.
- **Decision**: FIXED (Fix A) — 40 px zostaje; decyzja w Notes change.md, komentarz w _theme.scss z wyjątkiem 48 px dla „Dodaj” kategorii

### F4 — Brak testu PUT z kategorią innego konta

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/test/subscriptions/account-isolation.e2e-spec.ts
- **Detail**:
  - Nowa ścieżka `update` sprawdza kategorię przez `usableCategory`.
  - Test „właściciel robi PUT ze swoją subskrypcją, ale z kategorią innego konta → 400, wiersz bez zmian” istnieje tylko dla `POST`.
  - Research wskazywał ten przypadek jako ryzyko edycji (`backend-e2e-account-isolation/research.md:51`).
- **Fix**: Dopisać jeden przypadek w `account-isolation.e2e-spec.ts`: PUT właściciela z kategorią `other` → 400, a subskrypcja nienaruszona.
- **Decision**: FIXED — test „refuses an edit that moves a subscription into another account's category”

### F5 — Dialog usunięcia jako `alertdialog` z opisem

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/delete-subscription-dialog.ts:37
- **Detail**: Dialog potwierdzenia nieodwracalnej akcji ma domyślną rolę `dialog`, a jego treść nie jest powiązana jako opis. Czytnik ekranu ogłasza sam tytuł.
- **Fix**: W `openDeleteSubscriptionDialog` dodać `role: 'alertdialog'` i `ariaDescribedBy` wskazujące pierwszy akapit z nazwą subskrypcji (z id w szablonie).
- **Decision**: FIXED — role alertdialog + ariaDescribedBy; test dialogu i lokator Playwright zaktualizowane

### F6 — Czyszczenie komunikatu tylko w jednej ścieżce

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:214,222,245
- **Detail**:
  - `confirmRemove` czyści `statusMessage` przed `showStatus`, żeby ten sam tekst ogłosił się ponownie; `onSaved` i `onMissing` tego nie robią.
  - Dwa kolejne „Tej subskrypcji już nie ma na liście.” bez otwarcia panelu między nimi nie zostałyby ogłoszone drugi raz.
- **Fix**: Przenieść `statusMessage.set(null)` do `showStatus`, a w `confirmRemove` usunąć osobne czyszczenie.
- **Decision**: FIXED — czyszczenie statusMessage w showStatus

## Triage

| Ustalenie | Decyzja |
|---|---|
| F1 | FIXED |
| F2 | FIXED (Fix A) |
| F3 | FIXED (Fix A) |
| F4 | FIXED |
| F5 | FIXED |
| F6 | FIXED |

Po poprawkach:
- backend: lint, build, unit 188, e2e 88;
- frontend: build, test:ci 309 × 2 strefy, build:e2e, Playwright 13 — wszystkie zielone.

Kontrola z celowym uszkodzeniem: po zdjęciu blokady w `close()` test F2 jest czerwony.
