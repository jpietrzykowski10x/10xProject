<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Przyczyny porażek jobów i maili oraz ślad audytowy

- **Plan**: context/changes/failure-causes-and-audit-trail/plan.md
- **Scope**: Full plan (fazy z kompletnym Progress; faza 4 czeka na testy produkcyjne 4.3–4.5)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Bramki na HEAD (005c22b): moduły 453/453, `npm test` 726/726, `npm run test:e2e` 227 + 2 pominięte, lint 0, build OK; CI PR #80 zielone. Ręczne 1.6, 2.6, 3.6, 3.7 potwierdzone przez użytkownika wynikami z bazy i konsoli (2.6: alarm wywołany, niedostarczony przez blokadę IP na MyDevil). Poza planem: `blockedMailInFlight` (zatwierdzone w trakcie fazy 1), `failureCodeOf` już w fazie 1.

## Findings

### F1 — Wyjątek w kroku `send` zostawia rezerwację, a liczy się jako ponawiana porażka

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/trial-reminder.service.ts:177-187 (i catch w `sendDue` ~:133)
- **Detail**: Gdy `sendToUser` rzuci (kontrakt mówi „nigdy”, ale kod tego nie wymusza), wyjątek z `inStep('send')` trafia do zewnętrznego catch w `sendDue`: `usersFailed += 1`, a znacznik zostaje zarezerwowany. Alarm obiecuje ponowienie, a kolejny przebieg tych wierszy nie weźmie — przypomnienie faktycznie przepada, ale nie jako `remindersLost`.
- **Fix**: W `remind()` złapać wyjątek kroku `send`, zalogować go jak dziś (UUID, krok, kod), wywołać `release()` i zwrócić `failed` (albo `lost`, gdy zwolnienie padnie); zewnętrzny catch zostaje dla błędów przed rezerwacją.
- **Decision**: FIXED

### F2 — Awaria bazy w `roll_billing_dates` daje linię błędu na każdy wiersz i `partial` zamiast `failed`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/subscription-lifecycle.service.ts (pętla per wiersz w `rollBillingDates`)
- **Detail**: Gdy połączenie padnie po odczycie listy, każdy pozostały wiersz osobno kończy się błędem: N linii `Rolling the billing date … failed` w `err.log` i wynik `partial` z `billingRollFailed = N`, choć przyczyną jest baza, nie dane. Liczniki są poprawne, a kolejny przebieg nadrobi (warunek zaległości).
- **Fix**: Przerwać pętlę przy pierwszym błędzie klasy połączenia (kody `57P01`, `08*`, `ECONNREFUSED`/`ECONNRESET` z `failureCodeOf`) przez `JobStepError('roll_billing_dates', error)` → przebieg `failed` z `failure = roll_billing_dates: <kod>`; błąd danych jednego wiersza dalej tylko podnosi licznik.
  - Strength: Odróżnia awarię bazy od złego wiersza tak, jak plan odróżnia przyczyny; jedna linia zamiast N.
  - Tradeoff: Lista „kodów połączenia” to heurystyka do utrzymania; mały helper w `shared/database/` z testem.
  - Confidence: MED — scenariusz rzadki (job o 00:05, kilkadziesiąt wierszy), poprawność już jest.
  - Blind spot: Nie sprawdzono, jakie kody daje driver `pg` przy zerwanym połączeniu w środku pętli na MyDevil.
- **Decision**: FIXED

### F3 — W `err.log` nadal bywa treść błędu (stos, stare linie)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/jobs/job-run.service.ts (linia `failed` ze stosem; `recordSkipped`/start/retencja/koniec z `messageOf`), backend-subtracker/src/mail/services/mail.service.ts (`saveAudit` catch), backend-subtracker/src/admin/services/admin-audit.service.ts (`recordOutside` ze stosem)
- **Detail**: Plan wyklucza treść komunikatu tylko z `job_run.failure` i maila operatora — to jest dotrzymane. Ale pierwsza linia stosu to `QueryFailedError: <message>`, a starsze linie logują `message`; komunikat PG przy INSERT do `mail` może cytować adres. Reguła z `backend-patterns.md` („nigdy treści”) czyta się szerzej, niż działa log.
- **Fix**: Dopisać w `backend-patterns.md` (Logi błędów i odmów), że `err.log` może nieść stos z komunikatem błędu bazy, a zamianę starych linii na `failureCodeOf` zostawić na S-14 (format logu).
- **Decision**: FIXED

### F4 — `remindersLost` liczy użytkowników, a `remindersSent` triale

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/subscriptions/services/trial-reminder.service.ts (`case 'lost': result.remindersLost += 1`)
- **Detail**: Te same `counters` w `job_run` i w alarmie mają `remindersSent` = liczba triali, a `remindersLost` = liczba użytkowników. Operator porówna niewspółmierne liczby.
- **Fix**: Zwracać z `remind` liczbę zarezerwowanych wierszy także dla `lost` i dodawać ją (`remindersLost += trials`), jak `remindersSent`; testy i `backend-patterns.md` bez zmiany nazwy.
- **Decision**: FIXED

### F5 — Drobne rozjazdy tekstu planu i dokumentu z kodem

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/backend-patterns.md (przypomnienia: „krok `reserve`|`send`|`release`”), plan Desired End State („każdy wynik ma linię logu”)
- **Detail**: Zwolnienie łapie własny błąd, więc catch per użytkownik pokazuje tylko `reserve`/`send`; wynik `sent` nie ma linii logu (jak przed zmianą; plan w punkcie 1.2 jej nie wymienia). Kod jest poprawny, tekst mówi więcej.
- **Fix**: Poprawić `backend-patterns.md`: kroki `reserve`|`send`, zwolnienie ma własną linię; „linia logu przy każdym wyniku poza `sent`” w sekcji o mailach.
- **Decision**: FIXED

### F6 — Start API czeka na wysyłkę alarmu joba (sprzed tej zmiany)

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/jobs/job-run.service.ts (`track` → `await notifyOperator`), schedulery z awaitowanym startem
- **Detail**: Test 2.6: „Nest application successfully started” przyszło po 21 s, bo startowy przebieg cyklu życia czekał na nieudany alarm (ESOCKET). Przy wiszącym SMTP do ~90 s — dłużej niż health-check `deploy.sh` (5 prób co 3 s), a nieudany health-check przywraca bazę z dumpu. Od S-11, nie wprowadzone tutaj; ta zmiana zwiększa liczbę `partial` (np. `billingRollFailed`), więc i szansę.
- **Fix**: Nowa pozycja roadmapy / follow-up: alarm z `track` bez `await` dla przebiegów `startup` (jak start przypomnień w tle), z testem, że start nie czeka na SMTP.
  - Strength: Usuwa ryzyko cofnięcia deployu przez SMTP; wzorzec już istnieje (przypomnienia w tle).
  - Tradeoff: e2e muszą czekać na alarm inaczej (jak `idle()`).
  - Confidence: MED — zachowanie potwierdzone w logu 2.6, czas health-checku z `deploy.sh` wg backend-patterns.
  - Blind spot: Nie mierzono realnego czasu nodemailer na MyDevil przy wiszącym serwerze.
- **Decision**: ACCEPTED — follow-up w follow-ups/review-fixes.md (nowa pozycja roadmapy albo S-14)
