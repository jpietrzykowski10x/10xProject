# Refresh planu testów (2026-11-13) — plan implementacji

## Overview

Aktualizacja `context/foundation/test-plan.md` według zaakceptowanego briefu refreshu (`change.md`):
nowe ryzyko #7 (komponent się nie renderuje albo element warunkowy / komunikat walidacji nie pojawia
się, kiedy powinien), nowa faza 2 „Frontend component tests” w §3 z przenumerowaniem dotychczasowych faz
2–4 na 3–5, oraz zmiany w §4–§8. Do tego poprawka odwołań do starych numerów faz i sekcji cookbooka w
folderze `frontend-unit-tests`. Zmiana dotyczy wyłącznie dokumentów — testy komponentów powstaną w
osobnej zmianie, którą otworzy `/10x-test-plan` dla nowej fazy 2.

## Current State Analysis

- `test-plan.md` (145 linii) ma 6 ryzyk w §2 (`:39-44`) i tabelę wskazówek (`:46-55`), 4 fazy w §3
  (`:65-68`), cookbook 6.1–6.5 (`:106-125`) i §7 z czterema punktami (`:127-132`). Testów komponentów
  nie ma w żadnej fazie; F-03 wyklucza je wprost (`roadmap.md:122`).
- Wiersz fazy 1 w §3 (`:65`) ma status `planned`, choć implementacja trwa (commit `bf7c89f`, Progress
  fazy 1 w `context/changes/frontend-unit-tests/plan.md`).
- §4 profil (`:81`) mówi „frontend nie ma runnera ani testów”, a wiersz „unit (frontend)” (`:76`) —
  „none yet”; oba są nieaktualne po `bf7c89f` (Vitest 4.1.12 + jsdom 31, 3 pliki `*.spec.ts`).
- Odwołania do numerów faz 2–4 w `test-plan.md`: `:75`, `:77`, `:86`, `:97`, `:98`, `:99`, `:117`, `:121`
  (research §5). Odwołania „(Source: Phase 2 interview Q5.)” w `:129-130` dotyczą fazy wywiadu i
  zostają.
- Poza planem testów: „faza 3 planu testów” (= e2e przeglądarki) w
  `context/changes/frontend-unit-tests/plan-brief.md:49`, `plan.md:65`, `research.md:159`; „§6.5” (notatki
  fazy, po zmianie §6.6) w `plan-brief.md:46` oraz `plan.md:421` i `:439`.
- Research refreshu (`research.md`) ugruntował fakty potrzebne nowej fazie: domyślna reguła błędów
  Materiala, dwa mechanizmy pola trialu, harnessy Material 22.2.6 bez zone.js, brak `matchMedia` w jsdom,
  potrzeba `MATERIAL_ANIMATIONS` i `LOCALE_ID` `pl-PL`.

## Desired End State

- `test-plan.md` §2 ma ryzyko #7 i jego wiersz w Risk Response Guidance; §3 ma 5 faz (nowa faza 2 o
  statusie `not started`, faza 1 `implementing`); §4–§8 są spójne z nową numeracją i stanem po fazie 1;
  §6.2 to nowy przepis „Adding a component test” (TBD — see §3 Phase 2), a dotychczasowe 6.2–6.5 mają
  numery 6.3–6.6; §7 ma dwa nowe punkty i doprecyzowany punkt o stronach statycznych.
- W folderze `frontend-unit-tests` żadne odwołanie nie wskazuje „fazy 3 planu testów” jako e2e
  przeglądarki ani „§6.5” jako notatek fazy.
- Uruchomienie `/10x-test-plan` po tej zmianie: bieżącą fazą jest nadal faza 1 (`implementing`), a po
  jej zakończeniu orkiestrator zaproponuje `/10x-new` dla nowej fazy 2.

## What We're NOT Doing

- Pisania testów komponentów, zmiany `skipTests` w `angular.json` i providerów testowych — to zakres
  nowej fazy 2 (opisany w jej wierszu §3 i w §6.2 jako TBD).
- Zmian w roadmapie — testy komponentów śledzi §3 planu testów, F-03 zachowuje swój zakres (decyzja
  użytkownika).
- Zmian §1 i ryzyk #1–#6 (poza numeracją faz w ich odwołaniach).
- Zmiany kolejności: nowa faza 2 rusza po zakończeniu fazy 1 (decyzja użytkownika).
- Edycji bloków faz i sekcji Progress w `frontend-unit-tests/plan.md` poza poprawką dwóch odwołań w
  prozie (`:65` i `:421`/`:439`) — numeracja faz tamtego planu (`## Phase 2/3/4`) jest jego wewnętrzna
  i zostaje.
- Dodawania kotwic `file:line` do §2 (zasada #3 planu testów).

## Implementation Approach

Jedna przejrzana edycja `test-plan.md` w kolejności sekcji, potem poprawka odwołań w innych plikach i
kontrola grepem. Treść nowych wierszy pochodzi z briefu (`change.md`) i researchu refreshu; język jak w
reszcie planu testów (polski), słownik statusów §3 po angielsku. §2 cytuje dowody, nie pliki.

## Phase 1: Plan testów — ryzyko #7, nowa faza 2 i przenumerowanie

### Overview

Wszystkie zmiany w `context/foundation/test-plan.md`.

### Changes Required:

#### 1. §2 Risk Map i Risk Response Guidance

**File**: `context/foundation/test-plan.md`

**Intent**: Dodać ryzyko #7 jako scenariusz użytkownika z dowodami, bez kotwic w kodzie.

**Contract**: Nowy wiersz tabeli ryzyk po #6: „Ekran lub komponent nie renderuje się albo element
warunkowy (pole końca trialu, pole własnej kategorii) lub komunikat walidacji nie pojawia się wtedy, kiedy
powinien — użytkownik nie może dodać subskrypcji i nie wie dlaczego”; Impact High, Likelihood High;
Source: wywiad refreshu 2026-11-13 Q1, Q3, Q4; hot-spot dir `frontend-subtracker/src/app/pages` (67 zmian
plików / 30 dni); archive 2026-11-11-first-subscription-in-list (błąd kwoty widoczny dopiero w UI);
roadmap S-03, S-04, S-08, S-09, S-10 (nowe ekrany i formularze). Nowy wiersz Risk Response Guidance #7:
dowód ochrony — dla każdego stanu formularza element jest albo go nie ma, a po błędnym wpisie i próbie
zapisu komunikat przy polu jest widoczny (bez treści); każdy komponent da się utworzyć; must challenge —
„testy walidatorów dowodzą, że komunikat się wyświetla”, „»should create« dowodzi, że formularz działa”;
kontekst dla researchu — kiedy Material pokazuje błąd, jak pola warunkowe są pokazywane i włączane,
providery testowe (locale, animacje, breakpointy); warstwa — test komponentu (TestBed + jsdom, harnessy
Materiala), API zastąpione na granicy HTTP; antywzorzec — asercja dokładnej treści komunikatu, położenia
lub snapshotu, mockowanie wnętrza formularza.

#### 2. §3 Phased Rollout

**File**: `context/foundation/test-plan.md`

**Intent**: Wstawić fazę testów komponentów zaraz po fazie 1 i uzgodnić status fazy 1 ze stanem na dysku.

**Contract**: Faza 1: status `implementing` (folder bez zmian). Nowy wiersz 2: „Frontend component
tests” | „»Should create« dla wszystkich komponentów i dowód, że formularz subskrypcji pokazuje pola
warunkowe i komunikaty walidacji wtedy, kiedy powinien; `skipTests: false` dla schematu komponentu” |
#7, #3 | component | `not started` | —. Dotychczasowe wiersze 2, 3, 4 dostają numery 3, 4, 5 bez innych
zmian.

#### 3. §4 Stack

**File**: `context/foundation/test-plan.md`

**Intent**: Odzwierciedlić stan po fazie 1 i nową warstwę.

**Contract**: Wiersz „unit (frontend)”: Vitest + jsdom przez `@angular/build:unit-test`, wersje ^4.1.12 /
^31.0.1, notatka o dwóch strefach czasowych (`npm run test:ci`). Nowy wiersz „component (frontend)”:
TestBed + Angular Material/CDK test harnesses 22.2.6 w tym samym runnerze — „none yet — see Phase 2”.
Odwołania: `:75` Phase 2 → Phase 3, `:77` Phase 3 → Phase 4, `:86` „fazie 3” → „fazie 4”. Profil bazy
testów (`:81`) zaktualizowany (frontend: runner + 3 pliki testów jednostkowych, bez testów komponentów).

#### 4. §5 Quality Gates

**File**: `context/foundation/test-plan.md`

**Intent**: Testy komponentów w istniejącej bramce, przenumerowanie pozostałych.

**Contract**: Wiersz „unit frontend”: Catches uzupełnione o „zepsute renderowanie komponentów i
komunikaty walidacji (od §3 Phase 2)”, bez nowej bramki. `:97` Phase 2 → 3, `:98` Phase 3 → 4, `:99`
Phase 4 → 5.

#### 5. §6 Cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Miejsce na przepis testu komponentu obok testów jednostkowych frontu.

**Contract**: Nowe „### 6.2 Adding a component test” z treścią „TBD — see §3 Phase 2: wzorzec testu
komponentu z harnessem Materiala — element warunkowy obecny/nieobecny w danym stanie, komunikat
walidacji widoczny po próbie zapisu (bez asercji treści); »should create« jako minimum dla każdego
nowego komponentu”. Dotychczasowe 6.2–6.5 → 6.3–6.6; w nich `Phase 2` → `Phase 3` (API) i `Phase 3` →
`Phase 4` (browser e2e).

#### 6. §7 i §8

**File**: `context/foundation/test-plan.md`

**Intent**: Zapisać negatywną przestrzeń z wywiadu refreshu i datę przeglądu.

**Contract**: §7 nowe punkty: „Dokładna treść komunikatów” (treść może ewoluować; test sprawdza, że
komunikat jest widoczny przy błędzie; Source: wywiad refreshu Q5) i „Położenie elementów względem siebie”
(np. odstęp komunikatu od pola; Source: wywiad refreshu Q2, Q5). Punkt „Strony statyczne” doprecyzowany:
bez testów zachowania, ale z testem »should create« (§3 Phase 2; Source: decyzja planu refreshu). §8
„Strategy (§1–§5) last reviewed” i nagłówek „Last updated” na 2026-11-13 (bez zmian dat, jeśli już
równe).

### Success Criteria:

#### Automated Verification:

- §2 ma 7 wierszy ryzyk i 7 wierszy Risk Response Guidance, a §3 5 wierszy faz (`awk` po sekcjach `## 2.` i `## 3.` liczący wiersze tabel zaczynające się od `| <cyfra> |` / `| #<cyfra> |`)
- `grep -n "see Phase\|after §3 Phase\|see §3 Phase" context/foundation/test-plan.md` pokazuje tylko numery zgodne z nową tabelą §3 (API → 3, browser e2e → 4, hooki → 5, komponenty → 2, frontend unit → 1)
- `grep -n "^### 6\." context/foundation/test-plan.md` zwraca kolejno 6.1–6.6 z „Adding a component test” jako 6.2
- Wiersze #7 w §2 nie zawierają kotwic plików: `grep -E "^\| #?7 \|" context/foundation/test-plan.md | grep -E "\.(ts|html|scss):|\.ts\b"` nie zwraca wyników

#### Manual Verification:

- Przeczytany §2–§7: ryzyko #7 i nowa faza 2 zgodne z zaakceptowanym briefem i decyzjami planu (12 komponentów, `skipTests` tylko dla komponentów, kolejność po fazie 1, roadmapa bez zmian)

**Implementation Note**: Po weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: Spójność odwołań

### Overview

Poprawka odwołań do starych numerów faz i sekcji cookbooka poza `test-plan.md` oraz końcowa kontrola.

### Changes Required:

#### 1. Folder `frontend-unit-tests`

**File**: `context/changes/frontend-unit-tests/plan-brief.md`, `plan.md`, `research.md`

**Intent**: Odwołania do e2e przeglądarki i notatek fazy mają wskazywać nowe numery.

**Contract**: „faza 3 planu testów” / „fazy 3 planu testów” / „faza 3 planu” w znaczeniu e2e przeglądarki
→ „faza 4” (`plan-brief.md:49`, `plan.md:65`, `research.md:159`); „§6.5” w znaczeniu notatek fazy → „§6.6”
(`plan-brief.md:46`, `plan.md:421`, `plan.md:439`). Bez zmian w nagłówkach faz, Success Criteria i Progress
tamtego planu.

### Success Criteria:

#### Automated Verification:

- `grep -rn "faz[ay] 3 planu\|§6\.5" context/changes/frontend-unit-tests/` nie zwraca wyników
- `git diff --stat` dla tej fazy obejmuje tylko trzy pliki z folderu `frontend-unit-tests`, a w `plan.md` tamtej zmiany sekcja `## Progress` jest bez zmian

#### Manual Verification:

- `/10x-test-plan --status` pokazuje 5 faz: 1 `implementing`, 2 „Frontend component tests” `not started`, 3–5 jak dawne 2–4

**Implementation Note**: Po weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed commitem.

---

## Testing Strategy

### Unit Tests:

- Nie dotyczy — zmiana dokumentów.

### Integration Tests:

- Nie dotyczy.

### Manual Testing Steps:

1. Przeczytać §2–§7 `test-plan.md` z briefem refreshu obok.
2. `/10x-test-plan --status` — 5 faz, bieżąca faza 1.

## Performance Considerations

Brak.

## Migration Notes

Brak zmian kodu i danych. Numeracja faz w §3 zmienia się tylko dla faz `not started`, więc żaden istniejący
folder zmiany nie traci powiązania.

## References

- Brief refreshu: `context/changes/test-plan-refresh-2026-11-13/change.md`
- Research refreshu: `context/changes/test-plan-refresh-2026-11-13/research.md` (§5 — lista miejsc do zmiany)
- Plan testów: `context/foundation/test-plan.md`
- Schemat planu testów: `.claude/skills/10x-test-plan/references/test-plan-schema.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Plan testów — ryzyko #7, nowa faza 2 i przenumerowanie

#### Automated

- [ ] 1.1 §2 ma 7 ryzyk, a §3 5 faz
- [ ] 1.2 Odwołania „see Phase / after §3 Phase / see §3 Phase” zgodne z nową tabelą §3
- [ ] 1.3 Nagłówki §6 to kolejno 6.1–6.6 z „Adding a component test” jako 6.2
- [ ] 1.4 Nowe wiersze §2 bez kotwic plików

#### Manual

- [ ] 1.5 §2–§7 zgodne z briefem i decyzjami planu

### Phase 2: Spójność odwołań

#### Automated

- [ ] 2.1 Brak „faza 3 planu” i „§6.5” w folderze `frontend-unit-tests`
- [ ] 2.2 Diff fazy obejmuje tylko trzy pliki `frontend-unit-tests`, Progress tamtego planu bez zmian

#### Manual

- [ ] 2.3 `/10x-test-plan --status` pokazuje 5 faz z bieżącą fazą 1
