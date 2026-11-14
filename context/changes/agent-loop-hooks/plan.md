# Hooki pętli agenta — plan implementacji

## Overview

Etap 5 z `context/foundation/test-plan.md` §3: dwa lokalne hooki Claude Code, które oddają agentowi
regresję w chwili edycji (lint, typy, powiązany test), a na koniec tury łapią to, co kontrola po
edycji pomija (pełny unit, typy speców, edycje przez Bash). To zalecana bramka lokalna; bramki CI
z §5 (dwie strefy, build AOT, e2e) zostają bez zmian i jedyną bramką wymaganą.

Wytyczne Claude Code hooks (zdarzenia, wejście JSON, kody wyjścia, `stop_hook_active`, powłoka na
Windows): https://code.claude.com/docs/en/hooks, checked: 2026-11-14.

## Current State Analysis

- `.claude/settings.json` jest commitowany i ma tylko `permissions`; brak sekcji `hooks`. `.claude/hooks/` nie istnieje i nie jest ignorowany (`.gitignore` ignoruje `/.claude/skills/10x*`, `/.claude/.10x*`, `settings.local.json`), więc `10x sync` go nie nadpisze.
- Backend: brak skryptu typecheck; `oxlint --type-aware` bez `--type-check` nie zgłasza błędów typów. Pomiary (research): `oxlint --type-aware --type-check --quiet src/ test/` 0,5–0,6 s, `vitest related --run <plik>` 0,7–0,9 s, `tsc -p tsconfig.json --noEmit` 1,6–2,5 s, `vitest run` 4–6,4 s.
- Frontend: brak lint i typecheck aplikacji. `ngc -p tsconfig.app.json --noEmit` 3,1–3,3 s (typy + szablony), `tsc -p tsconfig.spec.json --noEmit` 1,7 s, `ng test --watch=false` w jednej strefie 8,6 s, `test:ci` 18,4 s.
- Środowisko: `jq` brak; w PATH drugi Node 22.14 (`C:\Program Files\nodejs`), którego Angular CLI 22 nie przyjmie; domyślna powłoka hooka na Windows to Git Bash.

## Desired End State

- Edycja pliku `.ts` w `backend-subtracker/{src,test}/` albo `.ts`/`.html` w `frontend-subtracker/src/`, która psuje lint, typ, szablon albo test powiązany (backend), wraca do agenta jako stderr hooka z kodem 2 przed następnym krokiem modelu: backend w ok. 1,5 s, frontend w ok. 3,5 s.
- Edycja każdego innego pliku (`context/`, `*.md`, `.env*`, `e2e/`, `.scss`, konfiguracja) kończy hook od razu kodem 0, bez uruchamiania czegokolwiek.
- Na koniec tury, jeśli stan aplikacji w git zmienił się od ostatniej kontroli (także przez Bash), Stop uruchamia pełniejszą kontrolę tej aplikacji; czerwony wynik blokuje turę raz, a przy `stop_hook_active: true` trafia do użytkownika jako `systemMessage`, bez drugiej blokady.
- `SUBTRACKER_AGENT_HOOKS=off` wyłącza oba hooki; test-plan §5 i §6 opisują działanie i wyłączanie.

### Key Discoveries:

- Punkty wejścia narzędzi to skrypty Node: `oxlint/bin/oxlint`, `vitest/vitest.mjs`, `typescript/bin/tsc`, `@angular/compiler-cli/bundles/src/bin/ngc.js`, `@angular/cli/bin/ng.js` — uruchamiane `spawnSync(process.execPath, [skrypt, ...])`, wzorzec z `frontend-subtracker/scripts/test-time-zones.mjs:12-21`. Bez `npx` (+0,4 s, `npm notice`) i bez `.cmd`/`shell: true`.
- Lint samego pliku nie widzi zepsutych wywołań w innych plikach (sabotaż sygnatury `subscriptionOrder`, research) — lintujemy całą aplikację.
- `ng test --include` daje rc 1 dla `.html` i dla `.ts` bez speca; `--include` nie jest typecheckiem aplikacji — testów frontu po edycji nie uruchamiamy (decyzja), tylko w Stop.
- `vitest.config.ts` (unit) nie czyta `.env`; czyta go tylko `vitest.config.e2e.ts`, `src/database/data-source.ts`, `src/cli/admin-grant.ts`.
- `PostToolBatch` nie ma matchera (biegnie po każdej paczce), dostaje `tool_calls[]` z `tool_name` i `tool_input` — według streszczenia docs; bieg dla pojedynczego wywołania i dostarczenie exit 2 do Claude'a są niepotwierdzone dosłownie → sprawdzenie w Fazie 1.
- Wbudowany limit 8 kolejnych blokad Stop resetuje się po każdym wywołaniu narzędzia, więc nie chroni przed pętlą — reguła `stop_hook_active` jest w hooku.

## What We're NOT Doing

- Zmian w CI, skryptach `package.json` ani w `lint` backendu (np. `--type-check` w CI) — §5 bez zmian.
- Testów frontendu po edycji (także speca sąsiada) — tylko `ngc`; testy w Stop.
- Dwóch stref czasowych i buildu AOT w hookach — zostają w CI (`test:ci`, `ng build`).
- Uruchamiania `test:e2e`, Playwrighta, migracji, `start:*` ani czegokolwiek, co czyta `.env`; wypisywania środowiska.
- Hooków dla `NotebookEdit`, `FileChanged`, `SubagentStop`, `UserPromptSubmit`; edycje przez Bash łapie tylko Stop.
- Sprawdzania `.scss` (nie wpływa na typy ani testy) i kodu w `e2e/`/`scripts/` frontendu.
- Zmian w hookach użytkownika (`~/.claude/settings.json`, plugin `gitkraken-hooks`).

## Implementation Approach

Kolejność według kosztu × sygnału: najpierw wspólny szkielet i najtańszy, najmocniejszy sygnał (backend, ok. 1,5 s), z wczesnym sprawdzeniem jedynej niepewności platformy (`PostToolBatch`). Potem frontend (`ngc`), potem Stop jako siatka na to, co pomija kontrola po edycji. Na koniec dokumentacja w test-plan.

Pliki:

```
.claude/hooks/
  lib/agent-loop.mjs        wspólne: przełącznik, Node, ścieżki, uruchamianie, przycinanie
  lib/agent-loop.test.mjs   node:test dla czystych funkcji
  post-edit.mjs             PostToolBatch (albo PostToolUse po fallbacku)
  stop.mjs                  Stop
  .state/                   git-ignorowany: odciski Stop, blokady
```

Polecenie w `settings.json`: `node "${CLAUDE_PROJECT_DIR}/.claude/hooks/<x>.mjs"` — działa w Git Bash i w PowerShell.

## Critical Implementation Details

- **Ścieżki na Windows**: `tool_input.file_path` jest absolutna z backslashami; ścieżkę względną liczyć `path.relative(CLAUDE_PROJECT_DIR, file)` (win32 porównuje bez rozróżniania wielkości liter, np. `c:` vs `C:`) i normalizować do `/` przed filtrem. Ścieżka wychodząca poza projekt (`..`) → pomiń.
- **Wersja Node**: hook startuje pierwszym `node` z PATH, a narzędzia dziedziczą `process.execPath`. Gdy wersja < 24.15, hook nie uruchamia narzędzi, tylko kończy kodem 0 z `systemMessage` „hooki pomijane: Node X, wymagany 24 (fnm)” — nigdy jako czerwony test.
- **Wyjście dla agenta**: dzieci z `NO_COLOR=1`, `FORCE_COLOR=0`; stderr hooka = nagłówek „[agent-loop] <aplikacja>: <narzędzie> failed” + ostatnie ok. 40 linii wyjścia narzędzia, bez kodów ANSI. Środowisko przekazywane dzieciom (`PATH`), nigdy wypisywane.
- **Stop i strefa**: `ng test` w Stop z `TZ=Europe/Warsaw` w env dziecka (strażnik `src/test-time-zone.spec.ts` odrzuca inne strefy, gdy `TZ` jest ustawione).

## Faza 1: Wspólny szkielet, sprawdzenie zdarzenia i hook backendu po edycji

### Overview

Wspólna biblioteka hooków, sprawdzenie na żywo kontraktu `PostToolBatch`, hook po edycji dla backendu. Najtańszy sygnał o największej wartości: cała aplikacja backendu w ok. 1,5 s.

### Changes Required:

#### 1. Biblioteka wspólna

**File**: `.claude/hooks/lib/agent-loop.mjs`, `.claude/hooks/lib/agent-loop.test.mjs`

**Intent**: Jedno miejsce na reguły wspólne dla obu hooków, żeby filtr ścieżek i bezpieczeństwo nie rozjechały się między nimi. Czyste funkcje dostają testy `node:test`, bo to w nich fałszywa blokada edycji pliku nie-kodowego byłaby najdroższa.

**Contract**:
- `hooksDisabled(env)` — `true` przy `SUBTRACKER_AGENT_HOOKS=off`.
- `nodeProblem(version)` — `null` albo komunikat, gdy wersja < 24.15.
- `classify(absPath, projectDir)` → `{ app: 'backend' | 'frontend', kind: 'ts' | 'html' } | null`. Wchodzą tylko: `backend-subtracker/{src,test}/**/*.ts`, `frontend-subtracker/src/**/*.{ts,html}`. Wszystko inne → `null` (w tym `context/`, `*.md`, `.env*`, `e2e/`, `.scss`, `node_modules/`, ścieżki poza projektem).
- `editedFiles(hookInput)` → lista ścieżek z `tool_calls[]` (`tool_name` ∈ `Edit`, `Write`) albo z pojedynczego `tool_input.file_path` (kształt `PostToolUse`) — skrypt czyta oba kształty od początku, żeby fallback był tylko zmianą wpisu w ustawieniach.
- `runTool(appDir, scriptPath, args, extraEnv)` → `{ ok, output, ms }` przez `spawnSync(process.execPath, ...)`, `cwd` = katalog aplikacji, env bez kolorów.
- `tail(output, lines)` — ostatnie linie bez ANSI.
- Testy: tabela ścieżek → wynik `classify` (backslashe, wielkość litery dysku, każde wykluczenie z listy), oba kształty wejścia `editedFiles`, `nodeProblem` dla 22.14.0 / 24.15.0 / 24.21.0.

#### 2. Hook po edycji (backend)

**File**: `.claude/hooks/post-edit.mjs`

**Intent**: Po paczce edycji sprawdza każdą aplikację backendu, której plik dotknięto, raz na paczkę.

**Contract**: wejście JSON ze stdin; kolejność: przełącznik → filtr (brak plików aplikacji → `exit 0` bez uruchamiania czegokolwiek) → Node → backend: `oxlint --type-aware --type-check --quiet src/ test/`, potem `vitest related --run <edytowane pliki backendu>` (unit config; plik z `test/` daje „No test files found”, rc 0). Błąd → stderr (przycięty) + `exit 2`; czysto → `exit 0`, bez wyjścia. Gałąź frontendu w Fazie 2.

#### 3. Podpięcie i sprawdzenie zdarzenia

**File**: `.claude/settings.json`, `.gitignore`

**Intent**: Podpiąć hook w commitowanych ustawieniach i rozstrzygnąć niepewność docs, zanim zbudujemy na niej resztę.

**Contract**:
- `hooks.PostToolBatch` → `node "${CLAUDE_PROJECT_DIR}/.claude/hooks/post-edit.mjs"`, `timeout` 60.
- `.gitignore`: `/.claude/hooks/.state/`.
- Sprawdzenie w sesji (tymczasowy zrzut do `.claude/hooks/.state/probe.log` — tylko `hook_event_name`, `tool_name`, `file_path`, nigdy treść edycji; usunięty po sprawdzeniu): (a) jeden `Edit` uruchamia `PostToolBatch`; (b) `tool_calls[].tool_input.file_path` istnieje; (c) exit 2 + stderr dociera do Claude'a; (d) `systemMessage` z exit 0 widzi użytkownik.
- **Fallback (decyzja)**: jeśli (a) albo (c) nie zachodzi → wpis `hooks.PostToolUse` z `matcher: "Edit|Write"` zamiast `PostToolBatch`, a `post-edit.mjs` dostaje blokadę per aplikacja w `.state/` (drugi hook czeka na pierwszy, potem uruchamia własną kontrolę; blokada starsza niż `timeout` jest uznana za osieroconą i usuwana). Wynik sprawdzenia zapisać w Notes w `change.md`.

### Success Criteria:

#### Automated Verification:

- Testy biblioteki przechodzą: `node --test .claude/hooks/`
- Hook z ręcznym wejściem dla pliku `context/foundation/test-plan.md` kończy się kodem 0 bez uruchamiania narzędzi (np. `echo '<json>' | node .claude/hooks/post-edit.mjs; echo $?`)
- Hook z ręcznym wejściem dla czystego `backend-subtracker/src/subscriptions/subscription-order.ts` kończy się kodem 0 w ≤ 2 s
- Backend nadal zielony: `cd backend-subtracker && npm run lint && npm test`

#### Manual Verification:

- Sprawdzenie zdarzenia (a)–(d) wykonane, wynik i wybrany wariant (PostToolBatch / fallback) zapisany w `change.md`
- Sabotaż typu: `export const brokenType: number = 'a'` w `subscription-order.ts` przez Edit → agent dostaje `TS2322` od hooka; cofnięte
- Sabotaż wywołującego: dodatkowy pierwszy parametr w `subscriptionOrder(...)` → hook wskazuje `subscriptions.service.ts` (inny plik niż edytowany); cofnięte
- Sabotaż testu: zmiana logiki w `subscription-order.ts` łamiąca `subscription-order.spec.ts` → hook zgłasza czerwony `vitest related`; cofnięte
- Edycja `*.md` i pliku w `context/` nie uruchamia kontroli (brak opóźnienia, brak komunikatu)
- Dwie równoległe edycje plików backendu w jednej paczce → jedna kontrola (albo przy fallbacku: kontrole jedna po drugiej, bez nakładania)

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie sabotaży i wyniku sprawdzenia zdarzenia.

---

## Faza 2: Hook frontendu po edycji

### Overview

Rozszerzenie `post-edit.mjs` o frontend: `ngc --noEmit` dla całej aplikacji, łapiący błędy szablonów, których `tsc` nie widzi. Bez testów po edycji (decyzja — testy w Stop).

### Changes Required:

#### 1. Gałąź frontendu

**File**: `.claude/hooks/post-edit.mjs`

**Intent**: Edycja `.ts` albo `.html` w `frontend-subtracker/src/` uruchamia jeden przebieg `ngc` na paczkę; błąd typu lub szablonu wraca do agenta.

**Contract**: `ngc -p tsconfig.app.json --noEmit` (`@angular/compiler-cli/bundles/src/bin/ngc.js`, `cwd` = `frontend-subtracker/`). Edycja wyłącznie `*.spec.ts` frontu: `ngc` nie obejmuje speców (`tsconfig.app.json`), więc hook kończy się kodem 0 — spec sprawdza Stop. Paczka z plikami obu aplikacji: obie kontrole, wynik łączny (kod 2, jeśli którakolwiek czerwona; oba komunikaty).

### Success Criteria:

#### Automated Verification:

- Testy biblioteki przechodzą: `node --test .claude/hooks/`
- Hook z ręcznym wejściem dla czystego `frontend-subtracker/src/app/pages/register/register.html` kończy się kodem 0 w ≤ 4 s
- Frontend nadal zielony: `cd frontend-subtracker && npm test -- --watch=false`

#### Manual Verification:

- Sabotaż szablonu: `{{ doesNotExist }}` w `register.html` przez Edit → agent dostaje „Error occurs in the template of component Register”; cofnięte
- Sabotaż typu w `.ts` komponentu → hook zgłasza błąd; cofnięte
- Edycja pliku bez speca (`src/app/app.routes.ts`, zmiana nieszkodliwa) → brak fałszywego alarmu
- Edycja `.scss` i pliku w `e2e/` → brak kontroli

**Implementation Note**: Po fazie zatrzymaj się na ręczne potwierdzenie sabotaży.

---

## Faza 3: Hook Stop

### Overview

Kontrola na koniec tury dla aplikacji, których stan w git zmienił się od ostatniej kontroli — łapie edycje przez Bash, typy speców i pełny zestaw unit. Blokuje turę raz; nigdy nie zapętla.

### Changes Required:

#### 1. Odcisk stanu aplikacji

**File**: `.claude/hooks/lib/agent-loop.mjs` (+ testy)

**Intent**: Uruchamiać kosztowną kontrolę tylko wtedy, gdy coś się zmieniło, także zmianą przez Bash, i nie powtarzać jej w turach bez zmian.

**Contract**: `fingerprint(app)` = hash z SHA `HEAD` + `git status --porcelain` dla katalogów aplikacji (backend `src/`, `test/`; frontend `src/`) + hash treści każdego zmienionego i nieśledzonego pliku z tej listy. Zapis w `.claude/hooks/.state/stop-<app>.json` (`{ fingerprint, ok }`) po każdej kontroli, zielonej i czerwonej. Brak zapisu = zmiana.

#### 2. Hook Stop

**File**: `.claude/hooks/stop.mjs`, `.claude/settings.json`

**Intent**: Pełniejsza kontrola edytowanych aplikacji z regułą przeciw pętli.

**Contract**:
- `hooks.Stop` → `node "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop.mjs"`, `timeout` 120.
- Przełącznik → Node → dla każdej aplikacji z odciskiem różnym od zapisanego (aplikacje równolegle):
  - backend: `oxlint --type-aware --type-check --quiet src/ test/`, `tsc -p tsconfig.json --noEmit`, `vitest run`;
  - frontend: `tsc -p tsconfig.spec.json --noEmit`, `ng test --watch=false` z `TZ=Europe/Warsaw`.
- Wszystko zielone → `exit 0`, bez wyjścia.
- Czerwone i `stop_hook_active` ≠ `true` → stdout `{"decision":"block","reason":"<przycięty raport>"}`, `exit 0`.
- Czerwone i `stop_hook_active: true` → stdout `{"systemMessage":"[agent-loop] kontrole nadal czerwone: <aplikacje/narzędzia>"}`, `exit 0` — bez drugiej blokady.
- Odcisk bez zmian (także po czerwonym wyniku już zgłoszonym) → `exit 0` bez uruchamiania.

### Success Criteria:

#### Automated Verification:

- Testy biblioteki (w tym `fingerprint`) przechodzą: `node --test .claude/hooks/`
- Hook z wejściem `{"stop_hook_active":false}` przy czystym drzewie i zapisanym odcisku kończy się kodem 0 w ≤ 1 s
- Obie aplikacje nadal zielone: `cd backend-subtracker && npm test`, `cd frontend-subtracker && npm test -- --watch=false`

#### Manual Verification:

- Sabotaż przez Bash: `sed -i` łamiący test w `backend-subtracker/src/subscriptions/subscription-order.ts` (hook po edycji nie biegnie) → Stop blokuje turę z raportem `vitest run`; cofnięte
- Sabotaż typu w specu frontendu (`*.spec.ts`, który `ngc` pomija) → Stop zgłasza `tsc -p tsconfig.spec.json`; cofnięte
- Sabotaż testu frontendu (np. `Math.round` → `Math.floor` w `subscription-amounts.ts`) → Stop zgłasza czerwony `ng test`; cofnięte
- Pętla: nienaprawiony błąd po kontynuacji (`stop_hook_active: true`) → użytkownik widzi `systemMessage`, tura się kończy, brak drugiej blokady
- Tura bez zmian (sama rozmowa) → Stop nie uruchamia kontroli
- `SUBTRACKER_AGENT_HOOKS=off` (w `env` w `.claude/settings.local.json`) → oba hooki nie uruchamiają kontroli

**Implementation Note**: Po fazie zatrzymaj się na ręczne potwierdzenie sabotaży i zachowania przeciw pętli.

---

## Faza 4: Aktualizacja test-plan (§5, §6)

### Overview

Kontrakt jakości opisuje hooki: co robią, czego nie zastępują, jak je wyłączyć.

### Changes Required:

#### 1. Bramki i cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Następny agent i człowiek wiedzą z test-plan, co biegnie lokalnie po edycji i na koniec tury, i że CI pozostaje bramką wymaganą.

**Contract**:
- §5 wiersz „post-edit hook”: Where „local (agent loop: po paczce edycji + Stop)”, Required „recommended”, Catches — lint i typy całej aplikacji backendu, typy i szablony frontu, powiązane testy backendu w chwili edycji; pełny unit, typy speców i edycje przez Bash na koniec tury. Bez dwóch stref i AOT (CI).
- Nowa §6.7 „Agent-loop hooks — jak działają, jak wyłączyć” (krótko): pliki, zdarzenia i polecenia per aplikacja z czasami, filtr ścieżek, reguła Stop (odcisk, blokada raz → `systemMessage`), wymagany Node 24, wyłączenie `SUBTRACKER_AGENT_HOOKS=off` (`env` w `.claude/settings.local.json` albo powłoka) i `disableAllHooks` jako ostateczność (wyłącza też hooki pluginów), `node --test .claude/hooks/`; checked: 2026-11-14.
- §6.6: notatka „§3 Phase 5 (data)” z 2–3 liniami wniosków (wynik sprawdzenia `PostToolBatch`, zmierzone czasy).
- §4 wiersz AI-native i §8 „AI-native tool references last verified” → data wdrożenia.

### Success Criteria:

#### Automated Verification:

- §5 i §6.7 obecne: `grep -n "6.7\|post-edit hook" context/foundation/test-plan.md`

#### Manual Verification:

- §6.7 da się zastosować bez czytania planu: wyłączenie hooków według opisu działa

---

## Testing Strategy

### Unit Tests:

- `node --test .claude/hooks/` — `classify` (tabela ścieżek z każdym wykluczeniem, backslashe, litera dysku), `editedFiles` (oba kształty wejścia), `nodeProblem`, `fingerprint` (zmiana treści nieśledzonego pliku zmienia odcisk). Poza CI (brak root `package.json`) — lokalnie, jak same hooki.

### Integration Tests:

- Sabotaże w żywej sesji Claude Code (Fazy 1–3): typ, wywołujący w innym pliku, test backendu, szablon, spec frontu, edycja przez Bash, pętla Stop.

### Manual Testing Steps:

1. Edit łamiący typ w backendzie → komunikat hooka w następnym kroku agenta.
2. Edit `register.html` z nieistniejącym polem → komunikat `ngc`.
3. `sed -i` łamiący test → blokada Stop; bez naprawy → `systemMessage`, koniec tury.
4. Edycja `*.md` → brak opóźnienia.

## Performance Considerations

Budżet po edycji: backend ≤ ok. 1,5 s, frontend ≤ ok. 3,5 s (+ start Node ok. 0,1 s). `PostToolBatch` biegnie po każdej paczce (także samych odczytach) — filtr musi kończyć się przed startem jakiegokolwiek narzędzia. Stop ≤ ok. 10 s tylko przy zmienionym odcisku.

## Migration Notes

Hooki działają po zaakceptowaniu zaufania do workspace i przeładowują się bez restartu; `/hooks` pokazuje je tylko do odczytu. Cofnięcie: usunięcie sekcji `hooks` z `.claude/settings.json`.

## References

- Research: `context/changes/agent-loop-hooks/research.md`
- Test plan: `context/foundation/test-plan.md` §3 Phase 5, §4 (AI-native „When NOT to use”), §5
- Wzorzec wywołania narzędzi: `frontend-subtracker/scripts/test-time-zones.mjs:12-21`
- Docs hooków: https://code.claude.com/docs/en/hooks (checked: 2026-11-14)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wspólny szkielet, sprawdzenie zdarzenia i hook backendu po edycji

#### Automated

- [x] 1.1 Testy biblioteki przechodzą: `node --test .claude/hooks/` — ab58a91
- [x] 1.2 Hook dla pliku w `context/` kończy się kodem 0 bez uruchamiania narzędzi — ab58a91
- [x] 1.3 Hook dla czystego `subscription-order.ts` kończy się kodem 0 w ≤ 2 s — ab58a91
- [x] 1.4 Backend nadal zielony: `npm run lint && npm test` — ab58a91

#### Manual

- [x] 1.5 Sprawdzenie zdarzenia (a)–(d) i wybrany wariant zapisane w `change.md` — ab58a91
- [x] 1.6 Sabotaż typu → `TS2322` od hooka; cofnięte — ab58a91
- [x] 1.7 Sabotaż wywołującego → hook wskazuje inny plik; cofnięte — ab58a91
- [x] 1.8 Sabotaż testu → czerwony `vitest related`; cofnięte — ab58a91
- [x] 1.9 Edycja `*.md` i `context/` nie uruchamia kontroli — ab58a91
- [x] 1.10 Równoległe edycje backendu → jedna kontrola (lub kolejno przy fallbacku) — ab58a91

### Phase 2: Hook frontendu po edycji

#### Automated

- [x] 2.1 Testy biblioteki przechodzą: `node --test .claude/hooks/` — 4d8e6c8
- [x] 2.2 Hook dla czystego `register.html` kończy się kodem 0 w ≤ 4 s — 4d8e6c8
- [x] 2.3 Frontend nadal zielony: `npm test -- --watch=false` — 4d8e6c8

#### Manual

- [x] 2.4 Sabotaż szablonu → błąd szablonu Register od hooka; cofnięte — 4d8e6c8
- [x] 2.5 Sabotaż typu w `.ts` komponentu → błąd od hooka; cofnięte — 4d8e6c8
- [x] 2.6 Edycja pliku bez speca → brak fałszywego alarmu — 4d8e6c8
- [x] 2.7 Edycja `.scss` i `e2e/` → brak kontroli — 4d8e6c8

### Phase 3: Hook Stop

#### Automated

- [x] 3.1 Testy biblioteki (w tym `fingerprint`) przechodzą: `node --test .claude/hooks/`
- [x] 3.2 Stop przy czystym drzewie i zapisanym odcisku kończy się kodem 0 w ≤ 1 s
- [x] 3.3 Obie aplikacje nadal zielone

#### Manual

- [x] 3.4 Sabotaż przez Bash → blokada Stop z raportem `vitest run`; cofnięte
- [x] 3.5 Sabotaż typu w specu frontu → Stop zgłasza `tsc` speców; cofnięte
- [x] 3.6 Sabotaż testu frontu → Stop zgłasza `ng test`; cofnięte
- [x] 3.7 Pętla: przy `stop_hook_active` tylko `systemMessage`, bez drugiej blokady
- [x] 3.8 Tura bez zmian → Stop nie uruchamia kontroli
- [x] 3.9 `SUBTRACKER_AGENT_HOOKS=off` wyłącza oba hooki

### Phase 4: Aktualizacja test-plan (§5, §6)

#### Automated

- [ ] 4.1 §5 i §6.7 obecne w test-plan

#### Manual

- [ ] 4.2 §6.7 da się zastosować bez czytania planu
