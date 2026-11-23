<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Niezależny kanał alarmów operatora

- **Plan**: `context/changes/independent-alert-channel/plan.md`
- **Scope**: Full plan (CI review on PR #76)
- **Date**: 2026-11-23
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45273183073
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Test Coverage       | PASS    |
| Success Criteria    | PASS    |

## Podsumowanie

Kod realizuje plan we wszystkich trzech fazach. Każda zaplanowana zmiana ma werdykt MATCH, nic nie jest DRIFT ani MISSING:

- walidacja PROD w `env.ts` (`requireString` dla hosta, porównanie loginów bez wielkości liter, dokładny komunikat błędu);
- `.env.example`;
- `sendOperatorTestMail` i cienkie CLI na wzór `watchdog.ts`;
- skrypt w `package.json`;
- `enhancedStatusOf` i `isRecipientTypo` z regexem z planu;
- stan alarmu per typ w kolejności z „Critical Implementation Details”;
- `notifyOperator` zwracające `Promise<boolean>`;
- README w obu językach, `backend-patterns.md` i `CLAUDE.md`.

`JobRunService` się nie zmienił. Pliki spoza planu są metadanymi zmiany: `roadmap.md` (status S-12), `change.md`, `plan-brief.md` i `reviews/plan-review.md`.

Kontrole automatyczne, uruchomione w `backend-subtracker/` z `unset MODE`:

| Polecenie                                                       | Wynik                    |
| --------------------------------------------------------------- | ------------------------ |
| `npx vitest run src/config src/mail/operator-test-mail.spec.ts` | ✅ 3 pliki, 68 testów    |
| `npx vitest run src/mail`                                       | ✅ 5 plików, 66 testów   |
| `npm test`                                                      | ✅ 49 plików, 678 testów |
| `npm run test:e2e`                                              | ✅ 26 plików, 221 testów |
| `npm run lint`                                                  | ✅ exit 0                |
| `npm run build`                                                 | ✅ exit 0                |
| `npx prettier --check src/mail src/config src/cli`              | ✅                       |
| `npm run migration:show`                                        | ✅ bez nowych migracji   |

Uwagi do kontroli:

- `npm run lint` zgłasza ostrzeżenia `unbound-method` tylko w plikach sprzed PR.
- Celowe uszkodzenia z planu (1.2, 2.2) sprawdziłem analizą testów, bez zmieniania kodu:
  - usunięcie porównania loginów czerwieni `env.spec.ts:259`;
  - `readString` zamiast `requireString` dla hosta w PROD czerwieni `env.spec.ts:245`;
  - okno 15 min ustawione przed wysyłką alarmu czerwieni `mail.service.spec.ts:312`;
  - uznanie każdego 5xx za literówkę czerwieni `mail.service.spec.ts:201`.
- Browser e2e (`npm run build:e2e && npm run e2e`) tu nie działa. Obejmuje go wymagany check `browser-e2e` w `ci.yml` na tym PR, tak jak punkt 3.1 „CI zielone na PR”.
- Kontrole ręczne na produkcji czekają na człowieka:
  - 3.3: po deployu `/health` 200 i `node cli/operator-test-mail.js` z `exit 0`;
  - 3.4: watchdog bez `cannot run`.
- Punkt 3.2 (klucze w `shared/.env` przed merge'em) jest odhaczony; tego z CI nie da się sprawdzić.

## Findings

### F1 — Rezerwacja alarmu (60 s) może wygasnąć, zanim alarm zostanie wysłany

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — prawdziwy kompromis; warto się zastanowić przed decyzją
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/mail/services/mail.service.ts:234
- **Detail**:
  - Przed wysyłką alarmu typ dostaje rezerwację tylko na `OPERATOR_ALERT_RETRY_MS` (60 s). Jedna wysyłka transportem operatora może trwać dłużej: `connectionTimeout`, `greetingTimeout` i `socketTimeout` mają po 30 s (`mail.transport.ts:35-37`), a `socketTimeout` liczy się od nowa po każdej porcji danych.
  - Gdy serwer alarmów odpowiada wolno, kolejna porażka tego samego typu po 60 s uruchamia drugi alarm równolegle z pierwszym. Drugi alarm czyta `reported = state.skipped`, czyli liczbę, którą zgłasza już pierwszy.
  - Jeśli oba alarmy zostaną przyjęte, `state.skipped -= reported` (`:246`) wykona się dwa razy. Licznik spadnie poniżej zera, a następny alarm pokaże np. „pominięte od poprzedniego alarmu: -2”. Operator dostanie też dwa alarmy naraz.
  - Plan zakłada, że w trakcie wysyłki działa rezerwacja („Critical Implementation Details”). Ten przypadek graniczny nie ma testu.
- **Fix A ⭐ Recommended**: Dodać do `OperatorAlertState` flagę `inFlight`. Gdy jest ustawiona, porażka tylko zwiększa `skipped` i nie wysyła alarmu. Flagę zdejmuje się w `finally` po `notifyOperator`. Do tego test, w którym `notifyOperator` kończy się po ponad 60 s.
  - Strength: rezerwacja nie zależy wtedy od zegara i obejmuje cały czas wysyłki, czyli to, co plan opisuje słowami.
  - Tradeoff: jedno pole więcej i kilka linii; zawieszony alarm blokuje kolejne do timeoutu transportu (najwyżej ok. 90 s).
  - Confidence: HIGH — sekwencja wynika wprost z kodu `:221-250` i timeoutów transportu.
  - Blind spot: nie sprawdzone, jak długo w praktyce trwa wysyłka przez serwer MyDevil przy jego awarii.
- **Fix B**: Tylko zabezpieczyć licznik: `state.skipped = Math.max(0, state.skipped - reported)`.
  - Strength: jedna linia, licznik nigdy nie jest ujemny.
  - Tradeoff: podwójny alarm przy wolnym serwerze nadal może wyjść, a licznik może zaniżać skalę.
  - Confidence: MEDIUM — usuwa tylko objaw.
  - Blind spot: None significant.
- **Decision**: PENDING

### F2 — `errorCodeOf` powiela `smtpFieldsOf` i nie podaje statusu SMTP

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, wąska poprawka
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/mail/operator-test-mail.ts:34
- **Detail**:
  - Nowy `src/mail/smtp-error.ts` ma już `smtpFieldsOf`, które odczytuje `code` z błędu nodemailera. `operator-test-mail.ts` ma do tego własną funkcję `errorCodeOf`.
  - Linia `test mail failed (code: …)` nie podaje rozszerzonego statusu, choć `logFailure` w `MailService` go podaje. Skrypt służy właśnie do diagnozy kanału, więc `status: 5.7.1` dałby operatorowi więcej informacji, nadal bez adresu.
  - Plan wymaga tylko kodu, więc to nie odstępstwo od planu.
- **Fix**: Użyć `smtpFieldsOf` (z zamianą pustego kodu na `unknown`) i dopisać `status: <enhancedStatusOf(error)>`, gdy jest.
- **Decision**: PENDING

### F3 — Wrapper CLI `operator-test-mail` bez testu kodów wyjścia

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, wąska poprawka
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/cli/operator-test-mail.ts:34
- **Detail**:
  - Kontrakt planu obejmuje kod 1 przy błędzie env (`cannot run: …`) i `process.exitCode = ok ? 0 : 1`. Logika `sendOperatorTestMail` ma pełne testy, ale mapowania na kod wyjścia nie sprawdza żaden test.
  - To sprawdzą tylko ręczne kroki 1.6 i 3.3. Wzorcowy `src/cli/watchdog.ts` też nie ma własnego testu, więc wrapper jest spójny z resztą repo.
- **Fix**: Zostawić tak, jak jest (wrapper jest cienki), albo wydzielić funkcję zwracającą kod wyjścia i dodać do niej krótki test.
- **Decision**: PENDING

### F4 — Osobność skrzynki sprawdzana tylko po loginie

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, wąska poprawka
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/config/env.ts:184
- **Detail**:
  - Kod realizuje dokładnie kontrakt planu (porównanie samych loginów, ten sam host dozwolony), więc to nie odstępstwo od planu. Skutki tego kontraktu:
    - start w PROD odrzuci dwa różne konta o tym samym loginie na różnych hostach;
    - start w PROD przepuści alias o innym loginie, który prowadzi do tej samej skrzynki.
  - Przy jednym dostawcy (MyDevil) to bezpieczne uproszczenie.
- **Fix**: Bez zmiany kodu; ewentualnie jedno zdanie w `backend-patterns.md`, że osobność oznacza inny login, a nie gwarancję innego konta.
- **Decision**: PENDING

<!-- End of report -->
