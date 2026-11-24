<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Niezależny kanał alarmów operatora

- **Plan**: `context/changes/independent-alert-channel/plan.md`
- **Scope**: Full plan (przegląd lokalny po merge'u, stan `main` po PR #76 i #77)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-24
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

Wcześniejszy przegląd z CI (PR #76, przed poprawkami F1/F2 i epilogiem) leży w `reviews/impl-review-ci.md`.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success Criteria

- `npx vitest run src/config src/mail`: 7 plików, 128 testów, zielone.
- `npm test`: 49 plików, 679 testów, zielone.
- `npm run test:e2e`: 26 plików, 219 testów zielonych, 2 pominięte.
- `npm run lint`: tylko ostrzeżenia `unbound-method` w `roles.guard.spec.ts`, które istniały już wcześniej, bez błędów; `npm run build`: OK.
- Wiersze ręczne 1.6, 2.6, 3.2–3.4 są odhaczone z SHA. Na produkcji potwierdzone: `operator-test-mail.js` kończy się `exit 0` kanałem `separate`, a watchdog nie wpisuje `cannot run`.
- Rozszerzenia z triage CI (`inFlight`, `failureOf`) są spójne z kontraktem. Licznik `skipped` nie spada poniżej zera, flaga jest zdejmowana w `finally`, a porażka z nieudanym alarmem wraca do licznika.

## Findings

### F1 — Odmowy dotyczące nadawcy (5.1.7, 5.1.8) przy `RCPT TO` uchodzą za literówkę

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — prawdziwy kompromis; warto się zastanowić przed decyzją
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/mail/smtp-error.ts:26-37
- **Detail**:
  - Problem:
    - `isRecipientTypo` uznaje każdy status `5.1.x` przy `RCPT TO` za literówkę w adresie odbiorcy.
    - RFC 3463 zalicza jednak `5.1.7` (zła składnia adresu nadawcy) i `5.1.8` (zła domena nadawcy) do odmów po naszej stronie.
    - Postfix z domyślnym `smtpd_delay_reject=yes` ocenia reguły nadawcy dopiero przy `RCPT TO`. Przykład: `reject_unknown_sender_domain` zwraca `550 5.1.8 <from>: Sender address rejected`.
  - Skutek: przy złym `SMTP_FROM_EMAIL` albo DNS domeny nadawcy każdy mail do użytkownika kończy się tylko linią `warn`, bez alarmu. To dokładnie ta cicha awaria, przed którą chroni S-12.
  - Gdzie leży błąd:
    - Plan sam zdefiniował literówkę jako „5.1.x”, więc to wada kontraktu, a nie odstępstwo od planu.
    - Test `5.1.8` istnieje tylko dla `MAIL FROM` (`smtp-error.spec.ts:51`).
    - Komentarz w :27 obiecuje, że odmowa nadawcy alarmuje.
- **Fix A ⭐ Recommended**: Lista dozwolonych statusów odbiorcy: literówką jest tylko `5.1.1`, `5.1.2`, `5.1.3`, `5.1.6` i `5.1.10`; reszta `5.1.x`, w tym `5.1.0`, `5.1.7` i `5.1.8`, alarmuje. Do tego testy `RCPT TO` z `5.1.8` i `5.1.0` oraz poprawka komentarza i zdania w `backend-patterns.md`.
  - Strength: nieznany albo niejednoznaczny status alarmuje, czyli błąd idzie w bezpieczną stronę, jak przy 5xx bez statusu.
  - Tradeoff: serwer, który zwraca na nieistniejącą skrzynkę ogólne `5.1.0`, da alarm zamiast `warn`; przy pojedynczych literówkach to jeden alarm na 15 min.
  - Confidence: HIGH — kody z RFC 3463 i RFC 7505, zmiana w jednej funkcji z testami.
  - Blind spot: nie sprawdzone, jakie statusy zwraca przy nieistniejącej skrzynce serwer MyDevil i Gmail.
- **Fix B**: Wykluczyć tylko `5.1.7` i `5.1.8`, a resztę `5.1.x` zostawić jako literówkę.
  - Strength: najmniejsza zmiana, `5.1.0` nadal bez alarmu.
  - Tradeoff: `5.1.0 Sender address rejected` dalej przechodzi bez alarmu.
  - Confidence: MED — zależy od tego, jak konkretne serwery używają `5.1.0`.
  - Blind spot: jak w A.
- **Decision**: FIXED (Fix A: lista RECIPIENT_TYPO_STATUSES 5.1.1/5.1.2/5.1.3/5.1.6/5.1.10; testy RCPT TO z 5.1.0, 5.1.7, 5.1.8 i celowe uszkodzenie (powrót do 5.1.x) czerwieni 3 testy; komentarz, backend-patterns, README PL/EN i CLAUDE.md zaktualizowane)

### F2 — Dokumenty i komentarz nieaktualne po poprawkach z przeglądu CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, wąska poprawka
- **Dimension**: Pattern Consistency
- **Location**: deploy/mydevil/README.md:241, :506; context/foundation/backend-patterns.md:86; backend-subtracker/src/mail/operator-test-mail.ts:46-47
- **Detail**:
  - Commit de839a2 zmienił kod, ale nie opisy:
    - README PL :241 i EN :506 mówią, że linia skryptu testowego podaje „tylko kod błędu SMTP”, a teraz podaje kod i status;
    - komentarz `operator-test-mail.ts:46-47` mówi to samo („logs only the error code”).
  - `backend-patterns.md` (sekcja „Maile”) nie opisuje dwóch reguł, a kolejny slice (S-16) będzie zmieniał właśnie ten kod:
    - drugi alarm tego typu nie wychodzi, dopóki trwa wysyłka (`inFlight`), nawet po upływie rezerwacji;
    - po nieudanym alarmie zgłoszona liczba i bieżąca porażka wracają do licznika.
- **Fix**: Poprawić dwa zdania README (PL i EN) i komentarz na „kod i status SMTP”; dopisać do `backend-patterns.md` regułę `inFlight` i powrót liczby po nieudanym alarmie.
- **Decision**: FIXED (README PL/EN „kod i rozszerzony status”, komentarz w operator-test-mail.ts, backend-patterns: reguła inFlight i powrót liczby po nieudanym alarmie)

### F3 — Formatowanie „code: X, status: Y” napisane dwa razy

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, wąska poprawka
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/mail/operator-test-mail.ts:36-43; backend-subtracker/src/mail/services/mail.service.ts:174-179
- **Detail**: Skrypt testowy i `logFailure` niezależnie składają kod i status SMTP. Różnią się drobiazgiem: skrypt zamienia pusty `code` na `unknown`, serwis nie.
- **Fix**: Jeden helper `smtpFailureDetails(error)` w `smtp-error.ts` z testem, używany w obu miejscach.
- **Decision**: FIXED (smtpFailureDetails w smtp-error.ts z testami, używany przez logFailure i skrypt testowy; pusty code w logu serwisu też jako unknown)

### F4 — Porażki z okna 15 min bez domknięcia

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, wąska poprawka
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/mail/services/mail.service.ts:224-259
- **Detail**:
  - Porażki policzone w oknie po przyjętym alarmie operator zobaczy dopiero w następnym alarmie, czyli przy kolejnej porażce tego typu.
  - Jeśli potem nic już nie padnie, ich liczba nie dotrze nigdzie poza log i wiersze audytu.
  - Plan na to pozwala, bo trwały stan i domknięcie są poza zakresem, ale dokumenty tego nie mówią.
- **Fix**: Jedno zdanie w `backend-patterns.md` (i w README przy alarmie o nieudanej wysyłce), że liczba pominiętych pojawia się dopiero w następnym alarmie, a pełny obraz dają wiersze `mail` i log.
- **Decision**: FIXED (zdanie o braku domknięcia w backend-patterns i README PL/EN)

### F5 — Drobne luki w testach i obsłudze błędu skryptu

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, wąska poprawka
- **Dimension**: Success Criteria
- **Location**: backend-subtracker/src/config/env.spec.ts; backend-subtracker/src/cli/operator-test-mail.ts:36
- **Detail**:
  - Desired End State mówi „ten sam host jest dozwolony”, a nie ma testu PROD z tym samym hostem i innym loginem.
  - `createMailTransport(env)` stoi poza `try`. Dziś niczego nie rzuca, ale gdyby zaczął, skrypt wypisze stos zamiast linii `cannot run: …`.
- **Fix**: Dopisać test PROD z tym samym hostem; objąć `createMailTransport` tym samym `try` co setup.
- **Decision**: FIXED (test PROD z tym samym hostem i innym loginem; createMailTransport w setup() pod tym samym try, błąd daje linię cannot run)
