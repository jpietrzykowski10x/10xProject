# Niezależny kanał alarmów operatora — Plan Brief

> Full plan: `context/changes/independent-alert-channel/plan.md`

## What & Why

Alarm do operatora ma dochodzić także wtedy, gdy nie działa wysyłka maili do użytkowników. Dziś przy pustym `NOTIFICATION_SMTP_*` alarmy idą tym samym kontem SMTP co linki logowania, więc padają razem z nimi. Nieudany alarm wycisza kolejne na 15 min, a odrzucenie przez relay albo limit wysyłki wygląda w logu jak literówka w adresie. Realizuje FR-020 i S-12, zamyka L2, L3, J6 i J10 z audytu obserwowalności.

## Starting Point

`createMailTransport` ma już osobny transport operatora, ale bez `NOTIFICATION_SMTP_*` wraca do transportu użytkowników, a `validateEnv` pozwala na to także w PROD. `MailService` trzyma jedną blokadę alarmu na proces i ustawia ją przed wysyłką. Każde 5xx przy `RCPT TO` traktuje jako literówkę. Watchdog i joby wysyłają alarmy przez ten sam transport operatora.

## Desired End State

Produkcja startuje tylko z osobną skrzynką alarmową (komplet `NOTIFICATION_SMTP_*`, inny login niż `SMTP_USERNAME`), a `operator:test-mail` sprawdza ją jednym mailem z kodem wyjścia. Alarm o nieudanej wysyłce ma okno 15 min dla każdego typu maila, liczone od przyjęcia alarmu. Po nieudanym alarmie kolejna próba idzie po 1 min, a alarm podaje liczbę pominiętych porażek. Literówką jest tylko status 5.1.x; relay, limit i polityka dają alarm.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Co jest literówką | Tylko rozszerzony status 5.1.x przy `RCPT TO`; 5xx bez statusu daje alarm | Relay (5.7.1), limit i SPF/DMARC nigdy nie przechodzą po cichu, a blokada ogranicza fałszywe alarmy do jednego na okno. |
| Blokada alarmu | Per typ maila, 15 min od przyjętego alarmu | Nieudany alarm nie wycisza kolejnych, a awaria linków nie zasłania awarii przypomnień. |
| Po nieudanym alarmie | Kolejna próba najwcześniej po 1 min, z licznikiem pominiętych | Padnięty kanał nie dokłada próby i 30 s timeoutu do każdej porażki, a operator widzi skalę. |
| Osobne konto | W PROD wymagany komplet pól i login różny od `SMTP_USERNAME` (bez wielkości liter); ten sam host dozwolony | Skopiowanie tych samych danych do obu zestawów nie daje pozornego osobnego kanału. |
| Weryfikacja | Skrypt `operator:test-mail` (logika w `mail/`, cienki CLI) | Powtarzalny test kanału na serwerze bez psucia konfiguracji, przydatny po każdej zmianie hasła. |

## Scope

**In scope:**
- walidacja PROD w `env.ts` i `.env.example`;
- skrypt `operator:test-mail`;
- `smtp-error.ts` (rozszerzony status);
- klasyfikacja literówki i stan alarmu per typ w `MailService`;
- `notifyOperator` zwracające wynik;
- README deployu, `backend-patterns.md`, `CLAUDE.md`;
- klucze na serwerze i test po deployu.

**Out of scope:**
- drugi dostawca poczty spoza MyDevil;
- przyczyny porażek i ślad audytowy (S-16);
- trwały stan blokady;
- blokada dla alarmów jobów i watchdoga;
- alarm przy serii literówek;
- sprawdzanie loginu SMTP przy starcie.

## Architecture / Approach

`validateEnv` w PROD wymaga `NOTIFICATION_SMTP_*`, więc `createMailTransport` zawsze dostaje osobny transport operatora: dla `MailService`, `JobRunService` i watchdoga. `MailService.deliver` klasyfikuje porażkę przez `isRecipientTypo` z `smtp-error.ts`. Przy porażce, która wymaga alarmu, stan typu (`blockedUntil`, `skipped`) decyduje o wysłaniu. Przed wysyłką typ dostaje rezerwację na 1 min, a po przyjęciu alarmu okno wydłuża się do 15 min.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Osobny kanał alarmów w PROD | Wymagana skrzynka alarmowa, inny login, `operator:test-mail` | Brak kluczy na serwerze przed merge'em wycofa deploy |
| 2. Alarm o nieudanej wysyłce | 5.1.x jako jedyna literówka, okno per typ od sukcesu, ponowienie 1 min, licznik | Kolejność zmian stanu przy równoległych porażkach |
| 3. Dokumentacja i produkcja | README, wzorce, `CLAUDE.md`, klucze w `shared/.env`, test na serwerze | Brak (sprawdzenia ręczne) |

**Prerequisites:** S-11 zarchiwizowane (jest); nowa skrzynka na MyDevil założona (jest, dane w lokalnych `.env` i `.env.mydevil`).
**Estimated effort:** ok. 1–2 sesje w 3 fazach; bez migracji.

## Open Risks & Assumptions

- Serwer MyDevil (Exim) podaje rozszerzone statusy w odpowiedzi na `RCPT TO`. Jeśli nie, każda literówka da alarm, ale najwyżej jeden na typ na 15 min (przyjęte).
- Stan blokady i licznik żyją w pamięci procesu: restart je zeruje, a pominięte porażki sprzed restartu nie trafią do alarmu (przyjęte).
- Awaria całej poczty MyDevil wyłącza też skrzynkę alarmową; ślad zostaje w `watchdog.log` (przyjęte w roadmapie).
- Klucze muszą trafić do `shared/.env` przed merge'em (są już na serwerze). Bez nich deploy pada na `migration:run`, a skrypty ról i watchdog nie działają; poprzednie wydanie je toleruje, więc zostają przy wycofaniu.
- W DEV bez `NOTIFICATION_SMTP_*` skrypt testowy idzie transportem użytkowników albo na konsolę i mówi to w pierwszej linii, więc `exit 0` nie udaje sprawdzenia osobnego kanału.

## Success Criteria (Summary)

- API w PROD bez osobnej skrzynki albo z tym samym loginem nie startuje, a z poprawną startuje i `operator:test-mail` daje `exit 0`.
- Złe hasło SMTP użytkowników daje jeden alarm na typ na 15 min z liczbą pominiętych, a nieudany alarm jest ponawiany po minucie.
- Odrzucenie 5.7.1 daje alarm, a 5.1.1 tylko `warn`, bez adresu w logu.

## References

- Roadmapa S-12, PRD v2 FR-020
- Audyt obserwowalności 2026-11-22 (L2, L3, J6, J10)
- Poprzedni slice: `context/archive/2026-11-22-operator-liveness-alerts/`
