# Zarządzanie kontami przez administratora (S-09) — Plan Brief

> Full plan: `context/changes/admin-account-management/plan.md`
> Research: `context/changes/admin-account-management/research.md`

## What & Why

FR-002 (must-have): administrator obsługuje konto, gdy zawiodą standardowe ścieżki. Może blokować, odblokowywać i „wylogować wszędzie”, a także zobaczyć wszystkie dane użytkownika. Blokada (`is_active = false`) to też fundament przyszłej blokady po nieudanych hasłach (FR-003) i przycisku „to nie ja” przy logowaniu z nowego urządzenia.

## Starting Point

Mechanizm ról (`RolesGuard`, `@Roles`, role USER i ADMIN, skrypt `admin:grant`) istnieje, ale nie ma żadnej trasy admina. `is_active` jest sprawdzane przy sesji i logowaniu, ale nic go nie ustawia. Blokada nie unieważnia sesji ani linków, a `verify` ma odłożoną z S-01 wadę kolejności blokad. Serwisy danych przyjmują `userId`, więc admin może ich użyć po wyeksportowaniu.

## Desired End State

Admin wchodzi w „Administracja”, wyszukuje konto po adresie i ogląda jego subskrypcje, sumy i budżet bez możliwości edycji. Blokuje konto z potwierdzeniem: użytkownik zostaje wylogowany wszędzie i dostaje mail, a przy próbie logowania widzi „Konto zablokowane, napisz na <kontakt>”. Każda akcja i każdy podgląd zostają w audycie. Jeden superadmin (tylko skryptem) zarządza także adminami.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Blokada | `is_active = false` + usunięcie linków + `revoked_at` sesji, jedna transakcja; admin blokuje i odblokowuje | Ten sam mechanizm posłuży FR-003 i zaufanym urządzeniom | Research (follow-up) |
| Reset dostępu | Tylko „wyloguj wszędzie”, konto zostaje aktywne | Zmiana adresu czy link od admina nie były potrzebne | Research (follow-up) |
| Info dla zablokowanego | Mail i 403 `account_blocked` z `contact` na logowaniu, rejestracji i weryfikacji | Musi wiedzieć, że nie zaloguje się; ujawnia tylko blokadę znanego adresu | Research + Plan |
| Kontakt | Nowy klucz env `SUPPORT_EMAIL` (wymagany w PROD) | Jedno źródło dla strony i maila, bez domeny w repo | Plan |
| Wgląd admina | Wszystko, tylko do odczytu | Edycja danych nie na tym etapie | Research (follow-up) |
| Hierarchia | Ranga: user 0, admin 1, superadmin 2; zarządzanie tylko przy wyższej randze i nie sobą | Jedna reguła daje wszystkie decyzje (nie siebie, nie superadmina) | Research + Plan |
| Superadmin | Jeden, nadawany tylko skryptem; pilnuje skrypt i częściowy indeks unikalny | „Jeden, by wszystkimi rządzić”, nawet przy ręcznym SQL | Plan |
| Role w API | Brak API ról; superadmin widzi swoją rolę w sesji, w panelu wygląda jak „admin” bez akcji | UI wie, co pokazać, a inni nie wiedzą, kto jest superadminem | Plan |
| Audyt | Zmiany i podglądy; tabela `admin_audit` z id bez FK i bez adresów, przeżywa usunięcie konta | Ślad przydatny pod RODO bez danych osobowych | Research + Plan |
| Wyszukiwanie | Fragment adresu (min. 3 znaki, max 20) i filtr zablokowanych | Admin trafia do konkretnego zgłoszenia zamiast przeglądać wszystkich | Plan |
| Maile | Blokada, odblokowanie, reset | Użytkownik wie o każdej zmianie dostępu | Plan |
| Joby i maile | Pomijają zablokowane, wyjątek: maile o dostępie | Decyzja użytkownika; job cyklu życia nadrabia po odblokowaniu | Research (follow-up) |

## Scope

**In scope:**
- Rola `SUPER_ADMIN`, skrypty grant i revoke, indeks jednego superadmina, tabela audytu
- `AccountAccessService` (blokada, odblokowanie, reset), poprawka `verify`, 403 `account_blocked`, trzy maile, filtr w `sendToUser` i jobie
- `/admin/users` (wyszukiwanie, szczegóły z audytem podglądu, akcje) i dostęp `admin` w liście tras
- Strony admina, guard ról, komunikat blokady, nawigacja, browser e2e
- Dokumentacja, PRD, README deployu, sprawdzenie na produkcji

**Out of scope:**
- Edycja danych użytkownika, zmiana adresu, link wysyłany przez admina
- API ról, widok audytu w UI, powód blokady, pełna lista kont
- Samoobsługowe odblokowanie (z FR-003), zaufane urządzenia (Parked)

## Architecture / Approach

Moduł `admin/` (kontroler z `@Roles(ADMIN, SUPER_ADMIN)`, serwis wyszukiwania i szczegółów, serwis audytu, funkcja rangi) składa `AccountAccessService` z modułu `auth` i wyeksportowane `SubscriptionsService` i `BudgetService`. Akcje to jedna transakcja: blokada wiersza `user`, zmiana dostępu i wpis audytu. Mail wychodzi po commicie. Frontend dostaje `adminGuard`, dwie strony `Client` w app-shell bez własnych sum admina oraz tryb `readOnly` tabeli i wejście `totals` komponentu sum.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Model ról i audytu | `SUPER_ADMIN`, indeks „jeden”, skrypty, `admin_audit`, sprzątanie e2e | Indeks pisany ręcznie rozjedzie się między migracją a seederem dev |
| 2. Blokada i reset | Serwis dostępu, `verify`, 403 `account_blocked`, maile, filtr joba | Przypadkowa zmiana jednakowej odpowiedzi dla adresów aktywnych i nieznanych |
| 3. API `/admin` | Wyszukiwanie, szczegóły z audytem, akcje z rangą, dostęp `admin` w liście tras | Wyjątek od izolacji kont dostępny bez roli (ryzyko #1) |
| 4. Frontend | Komunikat blokady, panel admina, nawigacja, browser e2e | Strona admina ładująca sumy admina zamiast celu |
| 5. Dokumentacja i produkcja | Wzorce, README, PRD, sprawdzenie na produkcji | Brak `SUPPORT_EMAIL` na serwerze cofnie deploy |

**Prerequisites:** S-02 i S-10 zrobione (kaskady, `AccountDeletionService` jako wzór); lokalny PostgreSQL i `.env` z `MODE=DEV`.
**Estimated effort:** ~4–5 sesji w 5 fazach (2 i 3 największe).

## Open Risks & Assumptions

- Komunikat „konto zablokowane” świadomie ujawnia, że znany adres jest zablokowany (decyzja użytkownika). Adres aktywny i nieznany pozostają nie do odróżnienia.
- Wyszukiwanie `ILIKE` bez indeksu wystarcza w skali MVP.
- Audyt bez indeksów: gdy powstanie widok audytu w UI, dojdzie indeks pod jego zapytanie.

## Success Criteria (Summary)

- Admin blokuje konto z panelu; użytkownik jest wylogowany wszędzie, dostaje mail i przy logowaniu widzi komunikat z kontaktem; odblokowanie przywraca dostęp.
- Zwykły użytkownik nie ma dostępu do żadnej trasy `/admin` (401 albo 403 sprawdzane automatycznie dla każdej trasy), a nikt nie zarządza sobą ani superadminem.
- Każda zmiana i każdy podgląd danych konta zostawia wpis audytu, który przeżywa usunięcie konta.
