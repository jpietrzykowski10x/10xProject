---
change_id: ui-foundation
title: Ui foundation
status: implementing
created: 2026-11-10
updated: 2026-11-10
archived_at: null
---

## Notes

Decyzje z makiet (2026-11-10). Makiety: https://claude.ai/artifact/1GnVVi4MbScvb9CFMBT53J, wybrany kierunek to rząd **F2** (desktop i telefon). Pozostałe warianty na płótnie są odrzucone.

- **Biblioteka:** Angular Material 22, tylko motyw i pojedyncze `*-overrides`. Nie przebudowujemy komponentów.
- **Kolory:** granat `#14284B` (kolumna), zieleń `#0B6B4D` (przycisk główny, status „Aktywna”), limonka `#D6F25E` tylko na pasku limitu, ostrzeżenia na `#FDF1DC`.
- **Czcionka:** IBM Plex Sans. Promień 4 px w polach i przyciskach, pola z etykietą na obramowaniu.
- **Desktop:** granatowa kolumna z nawigacją i sumami po lewej, bez zwijania. Tabela na górze ekranu.
- **Panel dodawania:** domyślnie zamknięty, otwierany przyciskiem, otwarty sam przy pustej liście. Poniżej około 1200 px wysuwa się nad tabelę zamiast ją ściskać.
- **Telefon:** kolumna staje się nagłówkiem (kwota, rocznie, limit, kategorie rozwijane), menu w nagłówku, lista zamiast tabeli, dodawanie na osobnym pełnym ekranie z przyciskiem zapisu na dole.
- **Wiersz listy (S-02/S-03):** kliknięcie rozwija wiersz i pokazuje dane niewidoczne od razu, np. formę płatności, oraz link „Edytuj”. Podgląd nie wymaga wejścia w edycję.
- **Zakres makiet szerszy niż ta zmiana:** sumy, limit i ostrzeżenia wchodzą w S-04, S-07 i S-08. Tu powstają wygląd, układ i komponenty dla istniejących ekranów S-01.
- **Szerokość kolumny (faza 2):** jedna dla wszystkich układów, `--st-column-width: clamp(260px, 22vw, 300px)`, żeby nie skakała między stronami. W kolumnie stron publicznych jest nazwa strony, a opisy są pod formularzem.
- **Na później, poza tą zmianą:** zwijanie kolumny zalogowanego do wąskiej wersji przyciskiem, gdy dojdą kolejne pozycje menu (pomysł użytkownika z 2026-11-10).
- **Strona startowa `/`:** nowa, prerenderowana, według planszy `F2-Start` (decyzja z `/10x-plan`, szczegóły w `plan.md`, faza 4).
