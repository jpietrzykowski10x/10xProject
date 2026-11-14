# Hooki pętli agenta — Plan Brief

> Full plan: `context/changes/agent-loop-hooks/plan.md`
> Research: `context/changes/agent-loop-hooks/research.md`

## What & Why

Etap 5 z test-plan §3: agent ma dostać informację o regresji (lint, typy, szablon, powiązany test)
w chwili edycji, a nie w CI, i na koniec tury pełniejszą kontrolę tego, co kontrola po edycji
pomija. Lokalna, zalecana bramka; nigdy zamiennik bramek CI z §5.

## Starting Point

`.claude/settings.json` ma tylko uprawnienia; hooków nie ma. Research zmierzył narzędzia:
backend w całości ok. 1,5 s, frontend `ngc` ok. 3,2 s, pełne `ng test` 8,6 s, `test:ci` 18,4 s.

## Desired End State

Edycja psująca backend lub frontend wraca do agenta jako komunikat hooka przed następnym krokiem
(backend ok. 1,5 s, frontend ok. 3,5 s); edycja pliku nie-kodowego nie kosztuje nic. Na koniec tury
zmieniona aplikacja przechodzi pełny unit i typy speców — także po edycji przez Bash — a czerwony
wynik blokuje turę raz, potem tylko informuje użytkownika.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Backend po edycji | `oxlint --type-aware --type-check --quiet src/ test/` + `vitest related` | Lint pliku nie widzi zepsutych wywołań w innych plikach; całość to 0,5 s | Research |
| Frontend po edycji | Tylko `ngc --noEmit` | Mieści się w kilku sekundach, łapie szablony; testy w Stop | Plan |
| Zdarzenie po edycji | `PostToolBatch` (jedna kontrola na paczkę) | Brak współbieżnych `ngc`; sprawdzane na żywo w Fazie 1 | Plan |
| Fallback zdarzenia | `PostToolUse` `Edit\|Write` + blokada per aplikacja | Ten sam skrypt czyta oba kształty wejścia | Plan |
| Wykrywanie zmian w Stop | Odcisk git (HEAD + status + treść zmienionych) per aplikacja | Łapie edycje przez Bash, nie powtarza kontroli w turach bez zmian | Plan |
| Pętla Stop | Blokada raz; przy `stop_hook_active` tylko `systemMessage` | Limit 8 blokad resetuje się przy każdym narzędziu | Research / zlecenie |
| Wyłączenie | `SUBTRACKER_AGENT_HOOKS=off` (+ opis `disableAllHooks`) | Wyłącza tylko nasze hooki, osobiście | Plan |
| Język i miejsce skryptów | Node w `.claude/hooks/`, narzędzia przez `process.execPath` | Brak `jq`; bez `npx` (+0,4 s, szum) | Research |
| Node 22.14 w PATH | `systemMessage` „hooki pomijane”, nie czerwony test | Błąd środowiska ≠ regresja kodu | Research |

## Scope

**In scope:** `.claude/hooks/` (biblioteka + testy `node:test`, `post-edit.mjs`, `stop.mjs`), sekcja `hooks` w `.claude/settings.json`, `.gitignore` dla `.claude/hooks/.state/`, test-plan §4/§5/§6/§8.

**Out of scope:** zmiany CI i skryptów `package.json`; testy frontu po edycji; dwie strefy i AOT w hookach; e2e, migracje, `.env`; `NotebookEdit`/`FileChanged`; `.scss`.

## Architecture / Approach

`post-edit.mjs` czyta paczkę (`tool_calls[]`) lub pojedyncze wywołanie, filtruje ścieżki do
`backend-subtracker/{src,test}/*.ts` i `frontend-subtracker/src/*.{ts,html}`, uruchamia kontrolę raz
na aplikację i zwraca exit 2 + przycięty stderr. `stop.mjs` liczy odcisk git każdej aplikacji,
uruchamia pełniejszą kontrolę tylko po zmianie i zwraca `decision: block` albo `systemMessage`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Szkielet + zdarzenie + backend | Biblioteka, sprawdzenie `PostToolBatch`, kontrola backendu po edycji | `PostToolBatch` nie biegnie dla pojedynczej edycji → fallback |
| 2. Frontend po edycji | `ngc` na edycję `.ts`/`.html` | Czas ok. 3,5 s przy częstych edycjach |
| 3. Stop | Odcisk git, pełny unit + typy speców, reguła przeciw pętli | Fałszywe uruchomienia przy zmianach spoza agenta |
| 4. test-plan §5/§6 | Wiersz bramki, §6.7 „jak działają / jak wyłączyć” | — |

**Prerequisites:** Node 24 (fnm) w sesji Claude Code; zainstalowane `node_modules` obu aplikacji.
**Estimated effort:** ~2 sesje w 4 fazach.

## Open Risks & Assumptions

- Kontrakt `PostToolBatch` i `systemMessage` znamy ze streszczenia docs; Faza 1 go sprawdza, fallback jest ustalony.
- `oxlint --type-check` jest „experimental”; dlatego Stop dokłada `tsc`.
- Stop uruchomi się też po zmianach zrobionych ręcznie poza agentem — świadomie akceptowane.

## Success Criteria (Summary)

- Sabotaż typu, wywołującego, testu backendu i szablonu frontu wraca do agenta od hooka po edycji.
- Sabotaż przez Bash i w specu frontu łapie Stop; pętla kończy się `systemMessage`.
- Edycje plików nie-kodowych nie uruchamiają żadnej kontroli; test-plan §6.7 mówi, jak hooki wyłączyć.
