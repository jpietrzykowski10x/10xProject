# Refresh planu testów (2026-11-13) — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-11-13/plan.md`
> Research: `context/changes/test-plan-refresh-2026-11-13/research.md`

## What & Why

Użytkownik chce testów komponentów, a nie tylko czystych funkcji: boi się, że zmiana sprawi, że
komponent się nie pokaże albo że komunikat walidacji lub pole warunkowe nie pojawi się, kiedy powinno.
Plan testów nie ma dziś na to żadnej fazy, a katalog `pages` jest największym hot-spotem projektu. Ten
refresh dopisuje ryzyko #7 i fazę „Frontend component tests” do `test-plan.md`.

## Starting Point

`test-plan.md` ma 6 ryzyk i 4 fazy; faza 1 (testy jednostkowe frontendu) jest w implementacji (commit
`bf7c89f`), choć §3 pokazuje `planned`. Frontend ma runner Vitest + jsdom i 3 pliki testów czystych
funkcji, 12 komponentów bez testów.

## Desired End State

Plan testów ma ryzyko #7 z wskazówkami odpowiedzi, fazę 2 „Frontend component tests” (`not started`, po
fazie 1), fazy 3–5 jako dawne 2–4, przepis §6.2 jako TBD i nową negatywną przestrzeń w §7. Odwołania do
starych numerów faz w innych dokumentach są poprawione. `/10x-test-plan` po zakończeniu fazy 1 otworzy
zmianę dla testów komponentów.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Ryzyko #7 | High × High, formularz subskrypcji jako pierwszy cel | Obawy z wywiadu + największy hot-spot `pages` | Brief (wywiad refreshu) |
| Miejsce fazy | Nowa faza 2, dawne 2–4 → 3–5 | Ten sam runner co faza 1, główna obawa użytkownika | Brief |
| Bramka | W istniejącej „unit frontend” | Ten sam runner i krok CI | Brief |
| §7 | Bez dokładnej treści komunikatów i położenia elementów | Treść ewoluuje, ma być widoczna; wygląd sprawdzany okiem | Brief (wywiad Q5) |
| „Should create” | Wszystkie 12 komponentów | Pokrywa obawę „komponent się nie ładuje”, statyczne są tanie | Plan |
| `skipTests` | `false` tylko dla schematu komponentu, w fazie 2 | Nowy komponent od razu ma spec | Plan |
| Kolejność | Faza 2 rusza po zakończeniu fazy 1 | Korzysta z gotowego §6.1 i wzorca TestBed | Plan |
| Roadmapa | Bez zmian | Fazy testów śledzi §3, F-03 zachowuje zakres | Plan |
| Numer przepisu | §6.2 „Adding a component test”, dawne 6.2–6.5 → 6.3–6.6 | Testy frontu obok siebie | Plan |
| Strony statyczne w §7 | Bez testów zachowania, ale z „should create” | Spójność z decyzją o 12 komponentach | Plan |

## Scope

**In scope:**
- `test-plan.md`: §2 (#7 + wskazówki), §3 (nowa faza, przenumerowanie, faza 1 → `implementing`), §4
  (stan po fazie 1, wiersz komponentów), §5, §6 (nowy 6.2), §7, §8
- Odwołania „faza 3 planu testów” i „§6.5” w `context/changes/frontend-unit-tests/`

**Out of scope:**
- Kod testów komponentów i zmiana `angular.json` (robi to faza 2 we własnej zmianie)
- Roadmapa, §1, ryzyka #1–#6

## Architecture / Approach

Jedna spójna edycja `test-plan.md` w kolejności sekcji, treść z briefu i researchu refreshu, §2 tylko z
dowodami (bez kotwic plików). Potem poprawka odwołań w innym folderze i kontrola grepem numerów faz.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Plan testów: #7, faza 2, przenumerowanie | Zaktualizowany `test-plan.md` §2–§8 | Pominięte odwołanie do starego numeru fazy |
| 2. Spójność odwołań | Poprawione 6 odwołań w `frontend-unit-tests` | Przypadkowa edycja Progress tamtego planu |

**Prerequisites:** brak; zmiana nie dotyka kodu.
**Estimated effort:** jedna krótka sesja.

## Open Risks & Assumptions

- Research nie uruchomił testu z harnessem; to pierwszy krok nowej fazy 2, nie tego refreshu.
- Obie zmiany (faza 1 i refresh) są dziś w working tree tej samej gałęzi `change/frontend-unit-tests`;
  commit refreshu wymaga rozdzielenia plików albo osobnej gałęzi.

## Success Criteria (Summary)

- `/10x-test-plan --status` pokazuje 5 faz, w tym „Frontend component tests” jako fazę 2.
- Plan testów nazywa ryzyko #7 z dowodami i wskazówkami, a §7 mówi, czego w testach komponentów nie sprawdzamy.
- Żaden dokument nie wskazuje starego numeru fazy.
