<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Przypomnienie przed końcem triala (S-06)

- **Plan**: context/changes/trial-end-reminder/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Weryfikacja automatyczna (2026-11-16): `npm test` 318/318, `npm run test:e2e` 116/116 (16 plików), `npm run lint` bez nowych ostrzeżeń, `npm run build` OK, `migration:generate -- Check` → „No changes in database schema were found”.

## Findings

### F1 — Punkt 3.3 (po deployu) odhaczony przed deployem

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/trial-end-reminder/plan.md:339
- **Detail**: „Po deployu health-check przechodzi przy pierwszej próbie, log pokazuje przebieg przypomnień” jest `[x] — 413733e`, ale gałąź `change/trial-end-reminder` nie jest zmergowana do `main`, a deploy rusza tylko po pushu do `main`. Ten punkt nie mógł zostać sprawdzony.
- **Fix**: Przywrócić `- [ ]` dla 3.3 (z dopiskiem „po merge'u”) i odhaczyć dopiero po pierwszym deployu.
- **Decision**: FIXED

### F2 — Brak timeoutów SMTP: zawieszony serwer wstrzymuje cały przebieg

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/mail/mail.transport.ts:26
- **Detail**: `createTransport` nie ustawia `connectionTimeout`/`greetingTimeout`/`socketTimeout`, więc obowiązują domyślne wartości nodemailera (ok. 2 min / 30 s / 10 min). Job wysyła po kolei, więc serwer, który przyjmie połączenie i zawiśnie, trzyma każdego użytkownika minutami. W tym czasie flaga `running` pomija kolejny cron. Start w tle chroni deploy, ale nie sam przebieg. To samo dotyczy linku logowania (użytkownik czeka na odpowiedź `POST`).
- **Fix**: Jawne timeouty w `smtpSender` (np. `connectionTimeout: 15_000`, `greetingTimeout: 15_000`, `socketTimeout: 30_000`).
  - Strength: Jedno miejsce, obejmuje każdy mail aplikacji; błąd timeoutu trafia do istniejącej ścieżki `FAILED` + zwolnienie + alert.
  - Tradeoff: Zmiana poza listą plików planu; zbyt krótki timeout przy wolnym SMTP MyDevil dałby fałszywe błędy.
  - Confidence: MED — wartości do potwierdzenia ręcznym mailem przez SMTP MyDevil.
  - Blind spot: Nie mierzono typowego czasu odpowiedzi SMTP MyDevil.
- **Decision**: FIXED (inaczej: wszystkie trzy timeouty po 30 s, decyzja użytkownika)

### F3 — `beforeApplicationShutdown` działa tylko w e2e, a opis sugeruje gwarancję

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/trial-reminder.scheduler.ts:40; context/foundation/backend-patterns.md:145
- **Detail**: `main.ts` nie włącza `enableShutdownHooks` (świadomie, „What We're NOT Doing”), więc hook biegnie tylko przy `app.close()` w testach. Komentarz („before the database connection closes”) i zdanie w `backend-patterns.md` czytają się jak ochrona produkcyjna. Na produkcji zatrzymanie procesu w trakcie przebiegu (stop przy deployu, restart MyDevil) to przyjęte ryzyko „pad między rezerwacją a wysyłką”.
- **Fix**: Dopisać w komentarzu i w `backend-patterns.md`, że hook chroni `app.close()` (e2e), a na produkcji nie działa, bo `main.ts` nie włącza `enableShutdownHooks`.
- **Decision**: FIXED

### F4 — Funkcje formatowania daty i kwoty w module domeny

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/subscriptions/trial-reminder.ts:56-66
- **Detail**: `polishDate` (`YYYY-MM-DD` → `DD.MM.YYYY`) i polski zapis kwoty (`43.00` → `43,00`) nie znają domeny. Lekcja „Kod ogólny w `shared/`” kieruje je do `shared/date/` i `shared/money/` z własnym testem; kolejny job z mailem (FR-015) będzie ich potrzebował. Dodatkowo `toGrosze(amount)` jest wołany tylko jako walidator, a wynik jest odrzucany.
- **Fix**: Przenieść do `shared/date/calendar-day.ts` (`formatPolishDate`) i `shared/money/` (`formatPln`, z walidacją przez `toGrosze`) z testami obok; `trial-reminder.ts` zostawia tylko `/ mies.` / `/ rok`.
- **Decision**: FIXED (`formatPolishDate` w `shared/date/calendar-day.ts`, `formatPln` w `shared/money/grosze.ts`, testy `it.each` obok)

### F5 — `today` liczone poza `try`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/trial-reminder.scheduler.ts:70
- **Detail**: Komentarz mówi „run() never rejects”, ale `calendarDayIn(...)` stoi przed `try`; gdyby rzucił, `void this.run()` przy starcie dałoby unhandled rejection (Node 24 kończy proces). W praktyce przy stałej strefie nie rzuca. Scheduler S-05 liczy „dziś” wewnątrz `try`.
- **Fix**: Przenieść wyliczenie `today` do `try`; w `catch` mail operatora bez daty albo z `today ?? 'nieznany'`.
- **Decision**: FIXED

### F6 — Nieudane zwolnienie rezerwacji gubi przypomnienie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/trial-reminder.service.ts:167
- **Detail**: Gdy mail nie wyszedł, a `UPDATE` zwalniający rzuci (np. chwilowy błąd bazy), wiersze zostają zarezerwowane bez maila i przypomnienie dla tej daty końca już nie wyjdzie. To ta sama klasa co udokumentowany „pad między rezerwacją a wysyłką”, ale nie jest wymieniona w `backend-patterns.md`.
- **Fix**: Dopisać ten przypadek do punktu o przyjętym ryzyku w `backend-patterns.md` (S-06).
- **Decision**: FIXED

### F7 — E2e oznacza triale z lokalnej bazy dev jako przypomniane

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/test/support/e2e-app.ts (przebieg przy starcie), test/subscriptions/trial-reminder.e2e-spec.ts
- **Detail**: Lokalne e2e biegną na `subtracker-db-dev`, a fałszywy transport zawsze się udaje. Każde uruchomienie e2e ustawia `trial_reminder_sent_for` na trialach w oknie na kontach ręcznych testów, bez prawdziwego maila; późniejsza ręczna weryfikacja przypomnień nic nie pokaże.
- **Fix**: Zdanie w `test-plan.md` §6.4 i `dev-local/README.md` (albo zerowanie znaczników w `test-session.mjs seed`).
- **Decision**: FIXED (notka w `test-plan.md` §6.4 i `dev-local/README.md`)

### F8 — `isFileAddress` zdublowane w e2e

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/test/subscriptions/trial-reminder.e2e-spec.ts:71; test/support/e2e-app.ts:140
- **Detail**: Dwie wersje: pomocnik sprawdza prefiks i domenę, spec tylko prefiks.
- **Fix**: Wystawić `isFileAddress` z `E2eApp` i użyć go w specu.
- **Decision**: FIXED

## Triage (2026-11-16)

Wszystkie 8 ustaleń naprawione (F2 inaczej: timeouty 30 s). Po poprawkach: `npm test` 331/331, `npm run test:e2e` 116/116, lint i build OK. Punkt Progress 3.3 czeka na merge i deploy.
