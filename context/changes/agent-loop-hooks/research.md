---
date: 2026-11-14T22:10:40+01:00
researcher: Claude (Opus 5.5) via /10x-research
git_commit: c9ba286
branch: change/agent-loop-hooks
repository: 10xProject (SubTracker)
topic: "Etap 5 planu testów — hooki pętli agenta (lint, typecheck, unit po edycji i na koniec tury)"
tags: [research, test-plan, claude-code-hooks, oxlint, vitest, angular, windows]
status: complete
last_updated: 2026-11-14
last_updated_by: Claude (Opus 5.5)
---

# Research: Etap 5 planu testów — hooki pętli agenta

**Date**: 2026-11-14T22:10:40+01:00
**Researcher**: Claude (Opus 5.5) via /10x-research
**Git Commit**: c9ba286 (plus niezacommitowane: status wierszy 4–5 w `context/foundation/test-plan.md`, folder tej zmiany)
**Branch**: change/agent-loop-hooks
**Repository**: 10xProject (SubTracker)

## Research Question

Ugruntować etap 5 z `context/foundation/test-plan.md` §3 („Agent-loop hooks”): czy edycja agenta,
która psuje lint, typy albo test jednostkowy, może wrócić do agenta w ciągu kilku sekund, w zakresie
aplikacji edytowanego pliku; co biegnie po każdej edycji, a co na koniec tury (Stop); jak Stop
łapie to, co pomija kontrola po edycji, bez nieskończonej pętli; jak działają hooki Claude Code
(zdarzenia, wejście JSON, kody wyjścia, plik ustawień); które skrypty da się użyć; czego nie robić
(zamiennik bramek CI z §5, nic wolniejszego niż kilka sekund po edycji, blokowanie edycji plików
nie-kodowych, wyciek `.env`).

## Summary

1. **Backend da się sprawdzić w całości po każdej edycji w ok. 0,5 s.**
   `oxlint --type-aware --type-check --quiet src/ test/` (binarka z `node_modules/.bin`) trwał
   0,49–0,63 s i w sabotażu złapał zarówno błąd typu w edytowanym pliku, jak i zepsute wywołanie
   w innym pliku po zmianie sygnatury. Ten sam przebieg na samym edytowanym pliku (0,39 s) wywołań
   w innych plikach **nie** złapał — więc po edycji lintujemy całą aplikację, nie plik.
   Do tego `vitest related --run <plik>` (0,7–0,9 s) uruchamia tylko testy, które importują plik.
   Razem ok. 1,5 s. Pełny `tsc --noEmit` (1,6–2,5 s) i pełny `vitest run` (4–6,4 s) pasują na Stop.
2. **Frontend nie mieści się w „kilku sekundach” w całości.** Pełne `ng test` w jednej strefie:
   8,6 s; `npm run test:ci` (dwie strefy): 18,4 s; `ngc -p tsconfig.app.json --noEmit`
   (typy + szablony całej aplikacji): 3,1–3,3 s; `tsc -p tsconfig.spec.json --noEmit`: 1,7 s;
   `ng test --include <jeden spec>`: 3,7 s (funkcja) do 6,4 s (formularz z harnessami);
   produkcyjny `ng build`: 7,3 s. Założenie z briefu, że pełny zestaw i typecheck AOT nadają się
   na każdą edycję, jest **obalone**; najtańsza użyteczna kontrola po edycji to `ngc --noEmit`
   (ok. 3 s, łapie błąd szablonu, którego `tsc` nie widzi) i ewentualnie spec sąsiadujący z plikiem.
3. **Hooki Claude Code (docs, checked 2026-11-14):** `PostToolUse` z matcherem `Edit|Write`
   (`MultiEdit` nie ma na liście narzędzi) dostaje na stdin JSON z `tool_input.file_path`
   (ścieżka absolutna, na Windows z backslashami). Kod wyjścia 2 pokazuje stderr Claude'owi
   („the tool already ran”), kod 0 — nic. `Stop` z kodem 2 albo `decision: "block"` + `reason`
   każe Claude'owi kontynuować; pole `stop_hook_active` mówi, że to już kontynuacja po hooku,
   a Claude Code sam przerywa po 8 kolejnych blokadach. Ustawienia: `.claude/settings.json`
   (commitowany, już istnieje, nie jest generowany przez 10x CLI) — hooki tam, skrypty w
   `.claude/hooks/` (poza ignorowanym `/.claude/skills/10x*`).
4. **Ryzyka środowiska:** hook dziedziczy PATH sesji (Node 24 z `fnm`), ale w systemie jest też
   `C:\Program Files\nodejs\node.exe` w wersji 22.14.0, którą Angular CLI 22 odrzuca; `jq` nie
   ma w Git Bash — skrypty hooków piszemy w Node. `ng test --include` z plikiem bez speca albo z
   `.html` kończy się kodem 1 (fałszywy alarm) — hook musi sam mapować plik na istniejący spec.
   Testy jednostkowe obu aplikacji nie czytają `.env` (czyta go tylko konfiguracja e2e backendu i
   CLI bazy), więc wyciek sekretów grozi tylko wtedy, gdy hook uruchomi e2e albo wypisze środowisko.

## Detailed Findings

### Hooki Claude Code — zachowanie z dokumentacji

Źródła: https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/hooks-guide,
https://code.claude.com/docs/en/settings, https://code.claude.com/docs/en/tools-reference
(pobrane 2026-11-14 przez subagenta; cytaty dosłowne, chyba że oznaczono „streszczenie”).

- **Zdarzenia**: `PostToolUse` — „After a tool call succeeds”; `PostToolBatch` — „After a full
  batch of parallel tool calls resolves, before the next model call”; `Stop` — „When Claude
  finishes responding”, nie biegnie po przerwaniu przez użytkownika; `SubagentStop` — koniec
  subagenta. „When an event fires, Claude Code runs the matching hooks in parallel.”
- **Matcher**: `Edit|Write` dopasowuje dokładnie te narzędzia; `Edit.*` byłby regexem i złapałby
  też `NotebookEdit`. Lista narzędzi zawiera `Edit`, `Write`, `NotebookEdit`; `MultiEdit` na niej
  nie występuje. Edycje przez `Bash` (np. `sed -i`) nie wywołują `PostToolUse` dla `Edit|Write`
  (docs wskazują na `FileChanged` w takim przypadku) — luka, którą domyka Stop.
- **Wejście `PostToolUse`**: `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
  `tool_name`, `tool_input.file_path`, `tool_response`, `tool_use_id`, `duration_ms`. Ścieżki
  „always absolute, with the platform's native separators, so backslashes on Windows”.
- **Wejście `Stop`**: `stop_hook_active` („`true` when Claude Code is already continuing as a
  result of a stop hook”), `last_assistant_message`, `session_id`.
- **Kody wyjścia**: 0 = sukces, „Claude never sees stderr from a hook that exits 0”; 2 = dla
  `PostToolUse` „Shows stderr to Claude; the tool already ran”; inny kod = błąd nieblokujący.
  Dla `Stop` kod 2 albo `{"decision":"block","reason":...}` zatrzymuje zakończenie tury, a
  Claude dostaje powód. `systemMessage` to ostrzeżenie widoczne dla użytkownika.
- **Pętla Stop**: „8-consecutive-continuation cap … The count of consecutive continuations
  resets each time Claude calls a tool” (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` zmienia limit).
  Uwaga: licznik resetuje każde wywołanie narzędzia, więc agent, który próbuje naprawiać i
  wywołuje narzędzia, może przekroczyć 8 blokad łącznie — limit nie zastępuje własnej reguły hooka.
- **Timeout**: domyślnie 600 s dla `command`, pole `timeout` w sekundach. `async: true` uruchamia
  hook w tle, ale wtedy `decision` nie działa, a wynik trafia do Claude'a dopiero w następnej
  turze (`asyncRewake` z kodem 2 budzi od razu).
- **Ustawienia**: `.claude/settings.json` („can be committed to the repo”), `.claude/settings.local.json`
  (osobiste, git-ignorowane), `~/.claude/settings.json`. Zmiany hooków są przeładowywane bez
  restartu; `/hooks` to podgląd tylko do odczytu. Hooki działają dopiero po zaakceptowaniu
  zaufania do workspace. `${CLAUDE_PROJECT_DIR}` = katalog główny projektu.
- **Windows**: hook może mieć `"shell": "powershell"`; domyślna powłoka to według streszczenia
  Git Bash (`bash`), a PowerShell tylko bez Git Bash (streszczenie, niezweryfikowane dosłownie).
  Docs zalecają cudzysłowy wokół `${CLAUDE_PROJECT_DIR}` w formie shell.

### Pliki ustawień w repo

- `.claude/settings.json:1-31` — commitowany (commit `720bb00`), dziś tylko `permissions`;
  bez sekcji `hooks`. Dobre miejsce na hooki projektu.
- `.claude/settings.local.json` — osobisty, w `.gitignore:6` (`/.claude/settings.local.json`).
- `.gitignore:2-3` ignoruje tylko `/.claude/skills/10x*` i `/.claude/.10x*`, więc
  `.claude/hooks/` (nowy katalog) będzie śledzony i nie zostanie nadpisany przez `10x sync`.
- `~/.claude/settings.json` zawiera plugin `gitkraken-hooks@gitkraken` (linia 11) — hooki
  użytkownika łączą się z projektowymi; plan nie musi go dotykać.

### Backend — skrypty i pomiary

Skrypty (`backend-subtracker/package.json`): `lint` = `oxlint --type-aware src/ test/`,
`test` = `vitest run`, `test:e2e` (czyta `.env`), `build` = `nest build` (tsconfig.build.json
wyklucza `test/` i `*spec.ts`). **Brak skryptu typecheck.** CI (`.github/workflows/ci.yml:37-40`)
uruchamia `lint`, `test`, `prepare-mydevil` — typy specy i `test/` nie są dziś sprawdzane przez
`tsc` nigdzie (oxlint `--type-aware` bez `--type-check` błędów typów nie zgłasza, patrz niżej).

Pomiary (Windows 10, Node 24.21.0, wywołanie `node_modules\.bin\*.cmd`, czas ściany, 2026-11-14;
dwa przebiegi, gdzie podano dwie wartości):

| Polecenie (z `backend-subtracker/`) | Czas | Uwagi |
|---|---|---|
| `oxlint --type-aware src/ test/` | 0,45–0,47 s | 9 linii ostrzeżeń `unbound-method` w `roles.guard.spec.ts`, rc 0 |
| `oxlint --type-aware --type-check src/ test/` | 0,49–0,63 s | rc 1 przy błędzie typu w dowolnym pliku |
| `oxlint --type-aware --type-check --quiet src/ test/` | 0,54 s | tylko błędy, 1 linia przy czystym kodzie |
| `oxlint --type-aware --type-check <plik>` | 0,39–0,44 s | nie widzi błędów w plikach wywołujących |
| `oxlint <plik>` (bez type-aware) | 0,09 s | |
| `npm run lint` / `npx oxlint ...` | 0,66 s / 1,06 s | `npx` dokleja linie `npm notice` |
| `tsc -p tsconfig.json --noEmit` | 2,52 s, potem 1,64 s | obejmuje `src/` i `test/` |
| `tsc -p tsconfig.build.json --noEmit` | 1,88 s | bez speców i `test/` |
| `vitest run` (pełny unit) | 6,39 s, potem 3,98 s | |
| `vitest related --run <plik>` | 0,67–0,89 s | plik bez testów: rc 0, „No test files found” |
| `vitest run <spec>` | 0,79 s | |

Sabotaże (cofnięte `git checkout`):
- Dopisany `export const brokenType: number = 'a'` w `src/subscriptions/subscription-order.ts`:
  `oxlint --type-aware` **nie** zgłasza (rc 0); `--type-check` zgłasza `TS2322` (rc 1, 0,44 s);
  `tsc` zgłasza (rc 2); `vitest related` zielony (vitest nie sprawdza typów).
- Dodany pierwszy parametr do `subscriptionOrder(...)`: `--type-check` na samym pliku rc 0;
  `--type-check src/ test/` rc 1; `tsc` wskazał `subscriptions.service.ts(52,24)` i
  `subscription-order.spec.ts(5,17)`; `vitest related` rc 1 (spec odpadł w runtime).
- Wniosek: `--type-check` w oxlint 1.86.0 jest oznaczony w `--help` jako „experimental”;
  pokrycie odpowiadało `tsc` w tych dwóch sabotażach — to nie dowód równoważności, dlatego `tsc`
  zostaje na Stop jako druga warstwa.

Szum w wyjściu: `vitest` wypisuje ostrzeżenie o wtyczce `vite-tsconfig-paths` i kolory ANSI;
hook powinien przekazywać Claude'owi tylko końcówkę wyjścia przy błędzie.

### Frontend — skrypty i pomiary

Skrypty (`frontend-subtracker/package.json`): `test` = `ng test`, `test:ci` =
`scripts/test-time-zones.mjs` (dwa przebiegi `ng test --watch=false`, strefy Warszawa i Nowy
Jork, `scripts/test-time-zones.mjs:9-23`), `typecheck:e2e` (tylko `tsconfig.e2e.json`),
`build`. **Brak skryptu lint i brak skryptu typecheck aplikacji.** Builder testów:
`@angular/build:unit-test` z `tsconfig.spec.json` i `providersFile`
(`angular.json`, `architect.test`). `@angular/compiler-cli` 22.2.0 dostarcza `ngc`.

| Polecenie (z `frontend-subtracker/`) | Czas | Uwagi |
|---|---|---|
| `tsc -p tsconfig.app.json --noEmit` | 1,45 s | nie widzi błędów szablonów |
| `tsc -p tsconfig.spec.json --noEmit` | 1,71 s | typy speców i importowanych plików |
| `ngc -p tsconfig.app.json --noEmit` | 3,06–3,28 s | typy + szablony całej aplikacji |
| `ng test --watch=false` (jedna strefa) | 8,58 s | 23 pliki, 269 testów |
| `npm run test:ci` (dwie strefy) | 18,40 s | tak jak job `frontend` w CI |
| `ng test --include <spec funkcji>` | 3,74 s | `subscription-amounts.spec.ts`, 18 testów |
| `ng test --include <plik .ts ze specem obok>` | 3,73 s | uruchamia spec sąsiada |
| `ng test --include <spec komponentu>` | 6,41 s | `subscription-form.spec.ts`, 22 testy |
| `ng test --include "src/app/subscriptions/**/*.spec.ts"` | 7,57 s | 4 pliki |
| `ng build` (produkcja, poza `dist/`) | 7,32 s | typecheck AOT; możliwy wpływ cache `.angular/` |

Sabotaż szablonu (dopisany `{{ doesNotExist }}` w `src/app/pages/register/register.html`, cofnięty):
`ngc` rc 1 z „Error occurs in the template of component Register” (3,19 s); `tsc` rc 0;
`ng test --include register.spec.ts` rc 1; `ng test --include subscription-amounts.spec.ts` rc 0
— `--include` kompiluje tylko to, co osiąga wybrany spec, więc nie jest typecheckiem aplikacji.

Pułapki `--include`:
- `.html` → rc 1, `TS6054 ... unsupported extension`.
- `.ts` bez speca obok (np. `src/app/app.routes.ts`) → rc 1, „No test suite found in file”.
  W `src/app` jest co najmniej 5 takich plików (`app.config*.ts`, `app.routes*.ts`,
  `auth/auth.service.ts` — pierwsze 40 plików sprawdzonych skryptem).
- Hook musi więc sam wybrać spec: `<plik>.spec.ts` dla `.ts`, `<komponent>.spec.ts` dla
  `.html`/`.scss` komponentu, a gdy speca nie ma — pominąć testy (zostaje `ngc`).

### Środowisko na tej maszynie

- `node` w sesji: `C:\Users\Jakub\AppData\Local\fnm_multishells\...\node.exe` (24.21.0, `fnm`
  default `v24.21.0`). Drugi w PATH: `C:\Program Files\nodejs\node.exe` 22.14.0
  (`where node`). Hook dziedziczy środowisko procesu Claude Code; jeśli sesję uruchomiono z
  powłoki bez `fnm env`, `ng` dostanie Node 22.14 i odmówi startu (CLAUDE.md, Tripwires).
  Skrypt hooka powinien sprawdzić `process.version` i zgłosić to wprost zamiast udawać błąd testu.
- `jq` nie ma w Git Bash (`which jq`) — przykłady z docs używające `jq` tu nie zadziałają;
  skrypt hooka w Node (`node "${CLAUDE_PROJECT_DIR}/.claude/hooks/<x>.mjs"`).
- `spawnSync(..., { shell: true })` z Node na Windows idzie przez `cmd.exe`; plik
  `node_modules/.bin/oxlint` (skrypt sh) wtedy nie startuje — trzeba `.cmd` albo bezpośrednio
  `node <pakiet>/bin/...` (jak robi `scripts/test-time-zones.mjs:12-21` z `ng.js`).

### Sekrety

- Unit backendu: `vitest.config.ts` nie ładuje env; `.env` czyta `vitest.config.e2e.ts`
  (`loadEnv`), `src/database/data-source.ts:14` i `src/cli/admin-grant.ts:23` (CLI).
- Unit frontendu: brak odczytu `.env` w `src/` i `angular.json` (grep `loadEnv|dotenv|env-file`).
- Więc: hook nie uruchamia `test:e2e`, `migration:*`, `e2e` Playwrighta ani `start:*`, i nie
  wypisuje `process.env`. Ścieżka edytowanego pliku `.env` (otwarty w IDE) ma być pomijana przez
  filtr rozszerzeń, nigdy czytana.

## Code References

- `.claude/settings.json:1-31` — ustawienia projektu, bez hooków
- `.gitignore:2-6` — ignorowane `skills/10x*`, `.10x*`, `settings.local.json`
- `backend-subtracker/package.json` (`scripts`) — `lint`, `test`, `test:e2e`; brak typecheck
- `backend-subtracker/.oxlintrc.json:3-6` — reguły (`no-floating-promises` error)
- `backend-subtracker/tsconfig.json:1-24` — bez `include` (cały projekt), `incremental: true`
- `backend-subtracker/vitest.config.ts` — unit bez env; `vitest.config.e2e.ts` — `loadEnv`
- `frontend-subtracker/package.json` (`scripts`) — `test`, `test:ci`; brak lint/typecheck
- `frontend-subtracker/scripts/test-time-zones.mjs:9-34` — dwa przebiegi stref, wzorzec wywołania `ng.js` przez `process.execPath`
- `frontend-subtracker/tsconfig.app.json`, `tsconfig.spec.json` — zakresy dla `ngc`/`tsc`
- `.github/workflows/ci.yml:37-40, 56-58` — bramki CI: backend `lint`+`test`+build, frontend `test:ci`+build

## Architecture Insights

Proponowany podział (do decyzji w `/10x-plan`, liczby z tabel powyżej):

| Moment | Backend | Frontend |
|---|---|---|
| Po edycji (`PostToolUse`, `Edit\|Write`, plik `.ts` w `src/`/`test/` aplikacji) | `oxlint --type-aware --type-check --quiet src/ test/` + `vitest related --run <plik>` ≈ 1,5 s | `ngc -p tsconfig.app.json --noEmit` ≈ 3,2 s; opcjonalnie spec sąsiada (+3,7–6,4 s) — przekracza „kilka sekund”, kandydat na Stop |
| Koniec tury (`Stop`), tylko aplikacje edytowane w tej turze | `tsc -p tsconfig.json --noEmit` + `vitest run` ≈ 4–6 s | `tsc -p tsconfig.spec.json --noEmit` + `ng test --watch=false` w jednej strefie ≈ 10 s |
| CI (bez zmian, §5) | `lint`, `test`, build | `test:ci` (dwie strefy), build AOT |

- Dwie strefy (`test:ci`, 18 s) zostają w CI; hook Stop w jednej strefie (strefa maszyny,
  `Europe/Warsaw`) świadomie nie zastępuje bramki.
- Filtr ścieżek po edycji: tylko `*.ts`/`*.html` (front także `*.scss`? — nie wpływa na
  typy ani testy, można pominąć) pod `frontend-subtracker/src/` lub `backend-subtracker/{src,test}/`;
  `context/`, `*.md`, `.env*`, `e2e/` → natychmiastowe `exit 0`.
- Pętla Stop: przy `stop_hook_active: true` hook nie blokuje drugi raz — wyjście 0 z
  `systemMessage` dla użytkownika („testy nadal czerwone”), żeby agent nie krążył po błędzie,
  którego nie umie naprawić. Wbudowany limit 8 to dopiero druga linia obrony.
- „Które aplikacje edytowano w turze”: albo znacznik zapisywany przez hook po edycji (per
  `session_id`, w git-ignorowanym miejscu), albo `git status --porcelain -- <app>` — to drugie
  odpala testy także w turach bez edycji, gdy w drzewie są niezacommitowane zmiany.
- Równoległe edycje: `PostToolUse` biegnie raz na edycję, a hooki w równoległych wywołaniach
  mogą się nakładać; `PostToolBatch` (raz po paczce) jest alternatywą — do sprawdzenia w planie.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §4 wiersz AI-native — „When NOT to use: jako zamiennik
  bramki CI albo z testami trwającymi dłużej niż kilka sekund”; §5 — post-edit hook
  „recommended after §3 Phase 5”. Pomiary potwierdzają ten zapis dla backendu; dla frontendu
  „kilka sekund” wyklucza testy po edycji poza pojedynczym specem.
- `test-plan.md` §6.1/§6.2 — prefiks `TZ=...` nie działa na Windows, stąd `test:ci`; hook
  zmieniający strefę musiałby powtórzyć wzorzec `env` w `spawnSync`.
- `context/foundation/lessons.md` — brak wpisów o hookach; reguła `dev-local/` dotyczy skryptów
  testów ręcznych, nie hooków (hooki to `.claude/hooks/`, uruchamiane przez Claude Code).

## Related Research

- `context/archive/2026-11-14-browser-critical-paths/research.md` — poprzedni etap (bez nakładania się).

## Open Questions

1. **Frontend po edycji**: tylko `ngc` (≈3,2 s), czy `ngc` + spec sąsiada (do ≈10 s)? Decyzja
   produktowa — próg „kilka sekund” z §4.
2. **Stop**: blokować turę (agent naprawia) czy tylko informować (`systemMessage`)? Blokowanie
   łapie regresję wcześniej, ale kosztuje 4–10 s na każdy koniec tury z edycjami.
3. **Wiarygodność `oxlint --type-check`** (experimental): zgodny z `tsc` w 2 sabotażach;
   czy dodać `--type-check` także do skryptu `lint` w CI — poza zakresem tej fazy (CI bez zmian).
4. **Domyślna powłoka hooka na Windows** — w docs potwierdzone tylko w streszczeniu; plan
   powinien użyć wywołania `node "<ścieżka>"`, które działa w obu powłokach, i sprawdzić je
   jednym ręcznym sabotażem po wdrożeniu.
5. **Nakładanie równoległych `PostToolUse`** (dwa `ng`/`ngc` naraz w tym samym katalogu) —
   niesprawdzone; do decyzji między `PostToolUse` a `PostToolBatch`.
6. Edycje przez `Bash` (`sed -i`) omijają hook po edycji — Stop jest tu jedyną siatką.
