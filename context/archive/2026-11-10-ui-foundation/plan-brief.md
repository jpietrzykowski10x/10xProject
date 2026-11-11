# Fundament interfejsu (ui-foundation) — Plan Brief

> Full plan: `context/changes/ui-foundation/plan.md`
> Decyzje projektowe i makiety: `context/changes/ui-foundation/change.md`

## What & Why

Wprowadzamy Angular Material z motywem projektu, szkielety stron na desktop i telefon, przenosimy ekrany S-01 na nowy wygląd i budujemy stronę startową. Robimy to przed S-02, żeby formularz dodawania i lista subskrypcji powstały od razu w docelowym stylu, bez przeróbek w każdym kolejnym slice'ie.

## Starting Point

Frontend ma tylko ekrany S-01 (rejestracja, logowanie, potwierdzenie linku, pusta lista, polityka, niedostępność) na jednym roboczym arkuszu stylów, bez biblioteki UI, szkieletu strony i wersji na telefon. Logika formularzy jest gotowa i zostaje.

## Desired End State

Każdy ekran ma wygląd F2: granatowa kolumna po lewej (na telefonie nagłówek), zielone przyciski główne, pola Materiala, czcionka IBM Plex Sans z własnego serwera. Zalogowany widzi szkielet z nawigacją i wylogowaniem, gotowy na listę z S-02. Pod `/` jest prerenderowana strona startowa z podglądem aplikacji i opisem trzech funkcji, a zalogowany trafia z niej na swoją listę.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Kierunek wizualny | F2: kolumna w kolorach A, panel dodawania domyślnie zamknięty | Wybrany przez użytkownika spośród wariantów A–F na makietach. | change.md |
| Biblioteka | Angular Material 22, tylko motyw i pojedyncze `*-overrides` | Wygląd F2 da się osiągnąć bez przebudowy komponentów. | change.md |
| Kolumna przed S-04 | Tylko działające elementy: nazwa, „Subskrypcje”, e-mail, „Wyloguj” | Bez fałszywych sum na produkcji. | Plan |
| Zakres względem S-02 | Motyw obejmuje select, table, toggle i sidenav, ale panel i lista powstają w S-02 | Ta zmiana zostaje mała, a S-02 nie decyduje o wyglądzie od nowa. | Plan |
| Czcionka | `@fontsource/ibm-plex-sans`, serwowana z MyDevil | Bez żądań do Google: prostsza polityka prywatności i późniejsze CSP. | Plan |
| Strona startowa | Hasło, podgląd aplikacji, opis problemu, trzy funkcje, drugie wezwanie | Pokazuje produkt, z odrobiną opisu; bez wymyślonych liczb i opinii. | Plan |
| Renderowanie `/` | Prerender; zalogowany przekierowany w przeglądarce | Gotowy HTML i treść dla wyszukiwarek. Jeśli zalogowany widzi stronę dłużej niż 1 s, przechodzimy na SSR. | Plan |
| Kolor przycisków | Primary = granat, zieleń tylko na `mat-flat-button` | M3 ma jeden kolor primary, a makiety mają granatowe pola i zielone akcje. | Plan |
| Błąd pola e-mail | Domyślna reguła Materiala: po opuszczeniu pola albo po wysłaniu | Standard biblioteki; komunikaty zostają te same. | Plan |
| Telefon | Przełączenie przy 840 px przez CSS, menu w nagłówku | Działa w prerenderze i bez JavaScriptu. | Plan |

## Scope

**In scope:**
- Angular Material, CDK, motyw, lokalna czcionka
- Układ publiczny i szkielet zalogowanego, desktop i telefon
- Ekrany S-01 na komponentach Materiala, bez zmian w logice
- Nowa strona startowa z prerenderem
- Deploy frontendu i testy na produkcji, w tym na telefonie

**Out of scope:**
- Formularz dodawania, lista, panel i rozwijany wiersz (S-02/S-03)
- Sumy, limit, kategorie, ostrzeżenia (S-04, S-07, S-08) i pozycja „Budżet”
- Tryb ciemny, ikony z Google, CSP, CSRF, testy automatyczne frontendu
- Treść polityki prywatności

## Architecture / Approach

Jeden plik motywu ustawia kolory, typografię i kształty Materiala. Dwa komponenty układu (`PublicLayout`, `AppShell`) dają kolumnę na desktopie i nagłówek na telefonie; strony wstawiają w nie treść przez `ng-content`. Wylogowanie przenosi się ze strony listy do `AppShell`. Strona startowa ma własny układ, a `guestGuard` przepuszcza na serwerze, żeby prerender `/` działał.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Material, motyw i czcionka | Zależności, motyw F2, IBM Plex Sans lokalnie | Paleta M3 nie trafia dokładnie w granat; rozwiązuje to `theme-overrides` |
| 2. Szkielety stron | Kolumna i nagłówek na telefonie dla stron publicznych i zalogowanego | Przełączanie układu bez JavaScriptu przy prerenderze |
| 3. Ekrany S-01 na Materialu | Formularze i komunikaty w nowym stylu | Utrata powiązań błędów z polami (dostępność) |
| 4. Strona startowa | Nowa `/`, prerender, przekierowanie zalogowanego | Zbyt długi widok strony startowej dla zalogowanego; wtedy SSR |
| 5. Wdrożenie | Produkcja, telefon, dokumentacja, pomiar przekierowania | Próg 1 s znany dopiero po deployu; SSR to drugi deploy |

**Prerequisites:** S-01 na produkcji (jest), branch `change/ui-foundation`, Node 24.
**Estimated effort:** ~3–4 sesje: faza 1–2 razem, 3, 4, potem wdrożenie.

## Open Risks & Assumptions

- Strona startowa opisuje funkcje, które powstaną w S-04–S-08, a trafi na produkcję wcześniej. Przyjęte, bo nie było jeszcze publicznego startu.
- Prerender `/` pokaże zalogowanemu stronę startową przez chwilę. Próg 1 s mierzymy tylko na produkcji w fazie 5, bo lokalny build produkcyjny woła produkcyjne API i nie ma tam sesji. Wariant SSR oznacza drugi deploy, przekazanie ciasteczka z serwera frontendu do API i wyłączenie transfer cache dla sesji.
- Frontend nie ma testów automatycznych, więc regresje wyglądu łapią tylko testy ręczne.
- Makiety są na prywatnym płótnie; teksty strony startowej są też w planie, więc implementacja od niego nie zależy.

## Success Criteria (Summary)

- Każdy ekran wygląda jak makiety F2 na desktopie i telefonie, a przepływ rejestracji i logowania działa jak przed zmianą.
- Strona startowa ma treść w gotowym HTML, a zalogowany szybko trafia na swoją listę.
- Aplikacja nie wysyła żadnych żądań do Google, a S-02 może budować formularz i listę na gotowym motywie.
