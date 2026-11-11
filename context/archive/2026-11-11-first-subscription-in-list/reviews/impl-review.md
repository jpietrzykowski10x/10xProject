<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Dodanie pierwszej subskrypcji i lista subskrypcji (S-02)

- **Plan**: context/changes/first-subscription-in-list/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 8 observations

Zakres: `3c48d2a..faf37ef` (merge PR #16). Fazy 1–3 miały wcześniej osobne przeglądy z triage (`impl-review-phase-1.md`, `impl-review-phase-2-3.md`); ten przegląd sprawdza fazę 4 (dokumentacja, CI, deploy), commity poprawek z przeglądów (`64c5079`, `f534880`) i spójność między fazami. Dokumentacja z fazy 4 zgadza się z kodem; kontrakt frontend ↔ API spójny po `f534880`; „What We're NOT Doing” zachowane; każdy dodatek spoza planu zapisany w Follow-ups lub raportach przeglądów. Kryteria automatyczne na `main`: backend 186 testów jednostkowych, 74 e2e, lint, build, `migration:generate -- Check` bez różnic (z zastosowaną `CategoryNameKey`); frontend build bez ostrzeżeń, `prepare-mydevil`, brak prerenderu `subscriptions/new`; CI PR #16 zielone (`backend`, `frontend`, `deploy-scripts`), Deploy backend i Deploy frontend — success. Testy ręczne 4.3–4.6 potwierdzone przez użytkownika na produkcji (pierwsza subskrypcja po rejestracji < 1 min, izolacja kont).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Migracja `CategoryNameKey` niesprawdzona na produkcji wprost

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: backend-subtracker/src/database/migrations/1794424078141-CategoryNameKey.ts:9-27
- **Detail**: Migracja jest ręcznie dopisana (kolumna nullable → backfill → NOT NULL → podmiana indeksu). Lokalnie zastosowana na `subtracker-db` i kontrola „No changes” przeszła; e2e jej nie uruchamiają (baza dev z `synchronize`). Na produkcji deploy przeszedł z health-checkiem, czyli migracje się wykonały, ale stanu tabeli nikt nie obejrzał.
- **Fix**: Na MyDevil jednorazowo: `SELECT count(*) FROM category WHERE name_key IS NULL;` (= 0) i `SELECT indexname FROM pg_indexes WHERE tablename = 'category';` (jest `UQ_category_owner_name_key`, brak `UQ_category_owner_name`).
- **Decision**: VERIFIED (produkcja 2026-11-11: 10 kategorii, 9 domyślnych, 0 pustych `name_key`; jest `UQ_category_owner_name_key`, brak `UQ_category_owner_name`)

### F2 — Wspólna baza dev a nowe kolumny NOT NULL

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/subscriptions/services/categories-seeder.ts:45-49
- **Detail**: `synchronize` nie doda kolumny NOT NULL do tabeli z wierszami (aplikacja nie wstaje przed seederem), więc komentarz seedera obiecuje aktualizację, której sam nie wykona — bazę dev poprawiono ręcznie. `subtracker-db-dev` jest wspólna dla wszystkich worktree: start ze starszego brancha usunie `name_key`, a powrót na `main` znów nie wstanie.
- **Fix**: Doprecyzować komentarz seedera i dopisać do `backend-patterns.md` (sekcja „Dane domenowe”): nowa kolumna NOT NULL w istniejącej tabeli = ręczne uzupełnienie bazy dev (skrypt w `dev-local/`) albo jej odtworzenie; worktree ze starszych branchy nie uruchamiają `synchronize` na wspólnej bazie dev.
- **Decision**: FIXED (`backend-patterns.md`: nowa kolumna NOT NULL a baza dev i worktree; komentarz w `categories-seeder.ts`)

### F3 — Nieudane ciche odświeżenie po zapisie: komunikat sukcesu przy starej liście

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:92-96, 126-134
- **Detail**: Po poprawce F2 z przeglądu faz 2–3 błąd cichego odświeżenia zostawia listę, ale bez nowej pozycji i bez sygnału — obok widnieje „Dodano subskrypcję…”. Anulowanie poprzednich żądań działa poprawnie.
- **Fix**: Przy błędzie cichego odświeżenia pokazać krótki komunikat „Nie udało się odświeżyć listy.” z przyciskiem „Spróbuj ponownie” (bez wstawiania pozycji po stronie klienta — kolejność zna tylko API).
- **Decision**: FIXED (`refreshFailed`: „Nie udało się odświeżyć listy.” + „Spróbuj ponownie”)

### F4 — Escape: sprawdzenie `aria-expanded` wychodzi poza panel

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:111-117
- **Detail**: `target.closest('[aria-expanded="true"]')` idzie w górę poza `<section>` aż do szkieletu. Dziś żaden przodek nie ma `aria-expanded`, ale przyszłe menu albo szuflada szkieletu z `aria-expanded="true"` po cichu wyłączy Escape.
- **Fix**: Dodatkowo wymagać, żeby znaleziony element był wewnątrz panelu (`(event.currentTarget as Element).contains(match)`).
- **Decision**: FIXED (dopasowanie `aria-expanded` tylko wewnątrz panelu)

### F5 — Zwężenie okna przy otwartym panelu gubi fokus

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:69
- **Detail**: Gdy fokus jest na liście (np. na przewijanej ramce tabeli), a okno zwęzi się poniżej 1200 px przy otwartym panelu, lista staje się `inert` i przeglądarka przenosi fokus na `<body>`. Przypadek rzadki.
- **Fix**: Efekt: gdy `listCovered()` zmienia się na `true`, a fokus jest w `.subscriptions__main`, przenieść go na nagłówek panelu.
- **Decision**: FIXED (efekt: przy przejściu `listCovered` false → true i fokusie na liście fokus na nagłówek panelu)

### F6 — `toNameKey` bez normalizacji Unicode

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/text/name-key.ts:5-7
- **Detail**: „Ś” jako jeden znak (U+015A) i jako „S” + U+0301 dają różne klucze, więc dwie identycznie wyglądające kategorie przejdą. Ta sama luka była przy `lower(name)` — nie jest to regres.
- **Fix**: `name.normalize('NFC')` w `TrimmedString` (nazwa i klucz zostają spójne), z przypadkiem w `trimmed-string.spec.ts`.
- **Decision**: FIXED (`TrimmedString`: `trim().normalize("NFC")` + testy)

### F7 — Roadmapa nie odzwierciedla jeszcze zakończenia S-02

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:47, blok S-02, wiersz Backlog Handoff S-02
- **Detail**: S-02 ma `in-progress`, w bloku zostało otwarte pytanie o listę kategorii (rozstrzygnięte: 9 domyślnych), a wiersz Backlog Handoff mówi „Gotowe do planowania”.
- **Fix**: Status `done` ustawi `/10x-archive`; przy archiwizacji zamknąć też pytanie o kategorie i wiersz Backlog Handoff.
- **Decision**: ACCEPTED — status `done` i zamknięcie pytania o kategorie przy `/10x-archive`

### F8 — Drobne braki w dokumentacji

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/first-subscription-in-list/plan.md (Follow-ups), context/foundation/backend-patterns.md („Dane domenowe”), CLAUDE.md (tripwire `dev-local/`)
- **Detail**: (a) `.gitignore` → `/dev-local/` nie jest wymienione w Follow-ups; (b) zdanie „Nie opieramy się na `lower()` w SQL” dotyczy unikalności, a `lower()` zostaje w remisie sortowania i w backfillu migracji; (c) `CLAUDE.md` wskazuje `dev-local/test-session.mjs`, którego nie ma w świeżym klonie (plik celowo poza gitem).
- **Fix**: Jedna linia w Follow-ups; pół zdania w `backend-patterns.md` („…w unikalności”); w `CLAUDE.md` dopisać, że skrypt jest lokalny i trzeba go odtworzyć w świeżym klonie.
- **Decision**: FIXED (Follow-up o `dev-local/`; „w unikalności” przy `lower()`; `dev-local/` commitowany bez danych osobowych, tokenów i haseł)
