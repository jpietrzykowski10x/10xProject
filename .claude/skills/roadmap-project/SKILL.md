---
name: roadmap-project
description: Przelicza procentową realizację roadmapy (pozycje F/S, wymagania must-have FR, etapy planu testów, streamy) z context/foundation/roadmap.md i buduje albo odświeża stronę (Artifact) z paskami postępu i grafem zależności. Use when the user runs /roadmap-project or asks for "postęp roadmapy", "procent realizacji", "odśwież mapę roadmapy", "drzewo zależności roadmapy", "roadmap progress".
---

# /roadmap-project — postęp i graf roadmapy

Liczy, ile roadmapy jest zrobione, i publikuje stronę z podsumowaniem i grafem zależności. Strona
jest generowana w całości skryptem, więc każde odświeżenie wygląda tak samo; nie pisz jej ręcznie.

Skill tylko czyta dokumenty projektu. Zmienia wyłącznie własne pliki obok tego pliku:
`state.json` (adres opublikowanej strony i jej tytuł) oraz `data/milestones/<M-N>.json` (zapisany stan
zamkniętych kamieni milowych, patrz niżej). Oba są commitowane razem ze skillem.

**Zamknięte kamienie milowe zostają na stronie.** To wykonana praca: każdy wpis z
`## Milestone History` w `roadmap.md` jest na grafie jako zamknięty pas pod bieżącym kamieniem
milowym i ma kartę w sekcji „Zamknięte kamienie milowe” na dole strony. Pomijamy je tylko wtedy, gdy
użytkownik wprost o to poprosi (argument `tylko-bieżący`).

Zamknięcie kamienia milowego usuwa z `roadmap.md` jego bloki pozycji, zależności i streamy. Skrypt
bierze je więc z ostatniej wersji `roadmap.md` w historii gita, w której ten kamień był bieżący,
i zapisuje wynik w `data/milestones/<M-N>.json`. Zamknięty kamień się nie zmienia, więc przy
kolejnych odświeżeniach skrypt czyta ten plik zamiast historii gita. Gdy nie ma ani pliku, ani wersji w gicie,
pozycje bierze z `## Done` (bez zależności).

## Argumenty

- brak — przelicz i odśwież stronę spod adresu z `state.json` (albo utwórz ją, jeśli adresu nie ma);
- `next <ID>` — wskaż pozycję oznaczaną jako „następna” (np. `next S-10`);
- `new` — utwórz osobną stronę zamiast odświeżać zapisaną;
- `tylko-bieżący` — pomiń zamknięte kamienie milowe (`--current-only`); tylko na wyraźną prośbę;
- `odśwież-historię` — zignoruj pliki `data/milestones/` i odczytaj zamknięte kamienie milowe z gita
  od nowa (`--refresh-history`), np. gdy zapisany plik powstał z błędnej wersji.

## Kroki

1. **Roadmapa musi istnieć.** Jeśli nie ma `context/foundation/roadmap.md`, napisz, że najpierw
   trzeba ją utworzyć przez `/10x-roadmap`, i zakończ.

2. **Ustal „następną” pozycję.** Kolejność: argument `next <ID>`; jeśli go nie ma, a w notatkach
   użytkownika (`fyi/todo-next.txt`, sekcja `== START NASTĘPNYM RAZEM`) albo w tej rozmowie wprost
   wskazano następny slice, użyj go. W pozostałych przypadkach nie podawaj `--next`: skrypt wybierze
   pozycję `in-progress`, a bez niej pierwszą w kolejności roadmapy, której wymagania wstępne są
   zrobione.

3. **Zbuduj stronę.** Z katalogu głównego repozytorium (ścieżkę wyjściową daj w katalogu scratchpad
   tej sesji):

   ```bash
   node .claude/skills/roadmap-project/scripts/build-roadmap-page.mjs \
     --out "<scratchpad>/roadmap-project.html" \
     --title "<title z state.json, jeśli jest>" \
     [--next <ID>] [--current-only] [--refresh-history]
   ```

   Skrypt zapisuje HTML i wypisuje na stdout JSON z liczbami: `items`, `mustHaveFr` (z listą
   brakujących FR i pozycji, które je dostarczą), `testPlan`, `streams`, `remaining`, `next`,
   `closedMilestones` (dla każdego zamkniętego: pozycje, FR, data i źródło danych),
   `savedClosedMilestones` (pliki `data/milestones/` zapisane w tym przebiegu),
   `omittedTransitiveEdges`. Kod wyjścia 2 = brak roadmapy.

   Co liczy (trzy miary w nagłówku dotyczą tylko bieżącego kamienia milowego):
   - **Pozycje roadmapy** — bloki `### F-NN:` / `### S-NN:` ze `Status: done` względem wszystkich.
   - **Wymagania must-have (FR)** — FR z linii `Scope anchors` w `## Milestone` (przed
     „Nice-to-have”); FR jest pokryte, gdy ma je w `PRD refs` co najmniej jedna zrobiona pozycja.
     Pozycje bez FR (np. NFR) są wymienione osobno.
   - **Etapy planu testów** — wiersze tabeli §3 w `context/foundation/test-plan.md` ze statusem
     `complete` (pomijane, gdy pliku nie ma).
   - **Streamy** — tabela `## Streams`; daty archiwum z `## Done`; graf z `Prerequisites` po
     usunięciu zależności przechodnich (wymienione pod grafem).
   - **Zamknięte kamienie milowe** — osobny pas na grafie (wszystkie pozycje zrobione) i karta z
     liczbą pozycji, pokryciem FR, datą zamknięcia i streamami.

4. **Pokaż podsumowanie w odpowiedzi** (po polsku): tabela z trzema miarami (stan „X z Y” i %),
   tabela streamów, następna pozycja i to, co zostało, a pod spodem jedna linia na każdy zamknięty
   kamień milowy (pozycje, FR, data zamknięcia). Jeśli `savedClosedMilestones` nie jest puste, napisz,
   że te pliki doszły do `data/milestones/` i trzeba je commitować. Liczby bierz wyłącznie z JSON-a
   skryptu.

5. **Opublikuj stronę** narzędziem Artifact:
   - `state.json` ma `url` i nie podano `new` → opublikuj `file_path` z tym `url`. Jeśli publikacja
     zostanie odrzucona, bo ta rozmowa nie czytała jeszcze tej strony, zrób `action: "read"` dla
     `url` i opublikuj ponownie ten sam plik (strona jest generowana, więc nie scalaj jej treści).
   - brak `url` albo `new` → nowa publikacja z `icon: "map"` i opisem w jednym zdaniu (np. „Postęp
     kamienia milowego i graf zależności roadmapy, stan na DD.MM.RRRR.”). Potem zapisz zwrócony adres
     w `state.json` (`url`), a gdy `title` był pusty, także tytuł użyty w `--title`.

6. **Zakończ linkiem** do strony i jednym zdaniem o zmianie od ostatniego razu, jeśli ją widać
   (np. „S-10 przeszło na done, 92% → 100%”).

## Zasady

- Nie edytuj `roadmap.md`, `test-plan.md` ani notatek — statusy zmieniają `/10x-implement` i
  `/10x-archive`. Jeśli liczby wyglądają źle, to znaczy, że dokument ma inny kształt niż oczekuje
  skrypt: powiedz o tym i popraw skrypt, nie dane.
- Wygląd strony (kolory SubTrackera, układ, teksty) zmieniaj w skrypcie, a potem przebuduj stronę.
