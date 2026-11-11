<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Dodanie pierwszej subskrypcji i lista subskrypcji (S-02)

- **Plan**: context/changes/first-subscription-in-list/plan.md
- **Scope**: Phases 2–3 of 4
- **Reviewed phases**: 2, 3
- **Date**: 2026-11-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

Zakres: commity `c00d66b`, `68751b3` (i zapisy SHA). Odstępstwa zatwierdzone przez użytkownika w `## Follow-ups` planu traktowane jako plan. Zgodność z planem: wszystkie pozycje faz 2–3 MATCH, brak MISSING/DRIFT; EXTRA nieszkodliwe (typowane defy `mat-table`, polskie etykiety datepickera, fokus na nagłówku panelu, błąd wczytania kategorii z ponowieniem). Kryteria automatyczne na HEAD: build bez ostrzeżeń (initial 364,95 kB), `prepare-mydevil` OK, brak prerenderowanego `subscriptions/new`. Testy ręczne 2.3–2.5 i 3.4–3.9 potwierdzone przez użytkownika.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Wygasła sesja wygląda jak awaria serwisu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:80, frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:187, :258-259
- **Detail**: Każdy błąd poza 400 (także 401) daje „Serwis jest chwilowo niedostępny” albo ogólny stan błędu. `authGuard` działa tylko przy nawigacji, nie ma interceptora 401. Po wygaśnięciu sesji przy otwartej stronie „Spróbuj ponownie” nigdy nie pomoże.
- **Fix A ⭐ Recommended**: Interceptor obok `credentialsInterceptor`: 401 z `environment.apiUrl` (poza `/auth/verify` i `/auth/session`) → nawigacja na `/sign-in`.
  - Strength: Jedno miejsce, obejmuje też S-03 i kolejne ekrany.
  - Tradeoff: Dotyka wspólnej warstwy HTTP z S-01; trzeba wykluczyć trasy, gdzie 401 jest oczekiwane (nieważny link).
  - Confidence: MED — wymaga sprawdzenia przepływu `/auth/verify` i wylogowania.
  - Blind spot: Zachowanie przy wyścigu kilku równoległych 401.
- **Fix B**: Obsłużyć 401 tylko w trzech handlerach S-02 (lista, kategorie, zapis).
  - Strength: Wąski zakres, zero ryzyka dla S-01.
  - Tradeoff: Kolejne ekrany muszą powtarzać to samo.
  - Confidence: HIGH — lokalna zmiana.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — `auth/session-expired.interceptor.ts`: 401 z API poza `/auth/` → `/sign-in`, błąd przekazany dalej)

### F2 — Nieudane ciche przeładowanie po zapisie kasuje listę; nakładające się ładowania

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:67-81
- **Detail**: `load(true)` po zapisie przy błędzie ustawia `{kind:'error'}` — lista znika, a obok wisi „Dodano subskrypcję…”. Każde `load()` otwiera nową subskrypcję HTTP bez anulowania poprzedniej, więc starsza odpowiedź może nadpisać nowszą.
- **Fix**: Przy błędzie cichego ładowania zostawić stan `ready`; anulować poprzednie żądanie (trzymać ostatnią `Subscription` i `unsubscribe()` przed nowym albo `Subject` + `switchMap`).
- **Decision**: FIXED (cichy błąd zostawia listę; `load()` anuluje poprzednie żądanie)

### F3 — Panel 840–1199 px: fokus trafia pod panel, brak Escape

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.scss:110-122, subscriptions.html:4, :58-60
- **Detail**: W trybie szuflady `inert` jest tylko na telefonie, więc treść pod panelem zostaje w kolejności Tab. Przycisk „Dodaj subskrypcję” (prawa krawędź nagłówka) leży pod panelem — Shift+Tab z panelu ląduje na niewidocznym przycisku (WCAG 2.4.11). Escape nie zamyka panelu; obawa z komentarza (Escape w `mat-select`) da się obejść: `mat-select` robi `preventDefault`, kalendarz jest w overlayu poza sekcją.
- **Fix A ⭐ Recommended**: `inert` na `subscriptions__main` także w trybie szuflady (drugi sygnał media query 840–1199.98 px) + `(keydown.escape)` na sekcji panelu, pomijając `event.defaultPrevented`.
  - Strength: Szuflada zachowuje się jak modal bez dodatkowej biblioteki; ten sam mechanizm co na telefonie.
  - Tradeoff: Przy szufladzie tabela pod spodem jest nieklikalna (zgodnie z charakterem nakładki).
  - Confidence: HIGH — `inert` już działa na telefonie.
  - Blind spot: Zachowanie Escape w datepickerze na urządzeniach dotykowych.
- **Fix B**: Tylko Escape, bez `inert`.
  - Strength: Mniej zmian.
  - Tradeoff: Problem zasłoniętego fokusu zostaje.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — lista `inert` gdy panel ją zakrywa, < 1200 px: `WIDE_MEDIA_QUERY`, `listCovered`; Escape na panelu z pominięciem otwartego `mat-select`)

### F4 — Dodanie własnej kategorii nadpisuje wybór użytkownika

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:222
- **Detail**: Po `createCategory` i ponownym wczytaniu listy `categoryId.setValue(created.id)` i `focus()` idą bezwarunkowo. Jeśli w trakcie żądania użytkownik wybrał inną kategorię, jego wybór zostaje po cichu zastąpiony.
- **Fix**: `setValue` i `focus()` tylko gdy `categoryId.value === NEW_CATEGORY`; w przeciwnym razie tylko odświeżyć listę.
- **Decision**: FIXED (nowa kategoria ustawiana tylko gdy wybrane nadal jest „Dodaj własną…”)

### F5 — Komunikat ładowania może nie zostać odczytany

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.html:30
- **Detail**: `<p role="status">` z „Wczytywanie subskrypcji…” pojawia się razem z treścią; czytniki często pomijają region live wstawiony z gotowym tekstem. Region `addedMessage` używa poprawnego wzorca (stały kontener).
- **Fix**: Usunąć `role` z akapitu ładowania albo wpisywać tekst do stale obecnego regionu.
- **Decision**: FIXED (usunięte `role="status"` z komunikatu ładowania)

### F6 — Przewijana ramka tabeli niedostępna z klawiatury

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.html:2
- **Detail**: `.table__frame` przewija się w poziomie (ok. 1200 px z panelem obok), a tabela na desktopie nie ma elementów fokusowalnych — w części przeglądarek nie da się jej przewinąć klawiaturą.
- **Fix**: `tabindex="0" role="region" aria-label="Lista subskrypcji"` na ramce.
- **Decision**: FIXED (ramka `role="region"`, `aria-label`, `tabindex="0"` tylko na desktopie, `:focus-visible`)

### F7 — Komentarz w SCSS błędnie opisuje kolejność wierszy

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.scss:44-45
- **Detail**: Komentarz mówi, że wiersze szczegółów są na końcu DOM; przy `multiTemplateDataRows` są przeplatane (wiersz, szczegóły, wiersz…). Selektor `:nth-last-child(2)` działa poprawnie, ale komentarz zachęca do „naprawy”.
- **Fix**: Przeformułować: „każdy wiersz ma za sobą swój wiersz szczegółów, więc ostatni wiersz subskrypcji jest przedostatni”.
- **Decision**: FIXED (komentarz przeformułowany)

### F8 — Nieaktualne sformułowania o `/subscriptions/new` w planie

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/first-subscription-in-list/plan.md (Phase 3 §4, Progress 3.7 i 4.5, Phase 4 §1 CLAUDE.md)
- **Detail**: Follow-ups zapisują rezygnację z trasy, ale Progress 4.5 („dodawanie na osobnym ekranie”) i zakres dokumentacji fazy 4 (`/subscriptions/new` w tripwire CLAUDE.md) nadal ją zakładają.
- **Fix**: W fazie 4 nie dopisywać `/subscriptions/new` do CLAUDE.md; test 4.5 wykonać jako „widok dodawania na `/subscriptions`” (mapowanie już w Follow-ups).
- **Decision**: ACCEPTED — do wykonania w fazie 4: bez `/subscriptions/new` w CLAUDE.md, test 4.5 na `/subscriptions`

### F9 — Helpery w `shared/` bez testów jednostkowych

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/shared/{date-only,decimal,pl-date-adapter}.ts, shared/validation/*, subscriptions/subscription-amounts.ts
- **Detail**: Reguła z `lessons.md` wymaga testu obok helpera w `shared/`; frontend nie ma test runnera. Zaplanowane jako F-03 `frontend-unit-tests` (przed S-03).
- **Fix**: Bez zmian teraz; te pliki są pierwszymi celami F-03.
- **Decision**: ACCEPTED — zakres F-03 `frontend-unit-tests`
