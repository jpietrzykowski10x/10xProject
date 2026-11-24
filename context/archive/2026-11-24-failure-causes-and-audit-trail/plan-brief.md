# Przyczyny porażek jobów i maili oraz ślad audytowy — Plan Brief

> Full plan: `context/changes/failure-causes-and-audit-trail/plan.md`
> Research: `context/changes/failure-causes-and-audit-trail/research.md`

## What & Why

FR-024 (S-16): zadania cykliczne i wysyłka maili rozróżniają przyczyny porażki zamiast jednego „nie udało się”, a usunięcie konta, odmowy akcji admina i jego wyszukiwania zostawiają ślad audytowy. Dziś:
- błąd bazy przy sprawdzaniu adresata wygląda jak „brak konta”;
- przypomnienia fałszywie alarmują przy koncie zablokowanym w trakcie;
- nieudany przebieg joba zostawia tylko `error.message` w logu;
- przy pytaniu „czy i kiedy usunąłem konto” albo „kto przeglądał listę zablokowanych” nie ma żadnego śladu.

## Starting Point

Są już:
- rejestr przebiegów `job_run` z alarmem (S-11);
- linie odmów `Denials` (S-13);
- okno alarmu per typ maila (S-12);
- `admin_audit` z `VIEW` i akcjami admina (S-09).

`sendToUser` zwraca `boolean`, `job_run` nie ma kolumny przyczyny, a `admin_audit` wymaga aktora i celu i nie ma kontekstu.

## Desired End State

- Mail: wynik `MailOutcome`. Błąd odczytu konta daje wiersz `FAILED` i alarm.
- Joby: rejestr i alarm podają `krok: kod`.
- Przypomnienia odróżniają pominięte, nieudane i stracone.
- `admin_audit` zapisuje wyszukiwanie (bez `q`), odmowę rangi, usunięcie konta i zmiany ról z CLI.
- CLI ról nie zgłasza zmian, których nie było.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Wynik maila | Enum `MailOutcome`; `lookup_failed` → wiersz `FAILED` i alarm | Zamyka L8, A5, J11 i J15; operator widzi awarię bazy | Plan |
| Przyczyna porażki joba | Kolumna `job_run.failure` z `krok: kod` (bez treści) | Historia przyczyn w SQL i w alarmie; komunikaty PG mogą cytować dane | Plan |
| Ślad usunięcia konta | Log `Account <uuid> deleted` i wiersz `ACCOUNT_DELETED` w `admin_audit` | Trwały dowód bez adresu, precedens UUID z S-09, bez nowej tabeli | Plan |
| Ślad wyszukiwania | Wiersz `SEARCH` z `{status, qLength, results}`, bez `q` | Ślad bez danych osobowych, zgodnie z anonimizacją z S-10 | Plan |
| Trwałe odmowy | Tylko odmowa rangi (`DENIED`), zapis po wycofaniu transakcji | Ślad tam, gdzie admin próbował przekroczyć uprawnienia; `role_missing` zostaje logiem z limitem | Plan |
| CLI ról | Uczciwe komunikaty, odmowa roli nieaktywnej, kod PG, `cause`, wiersze `ROLE_GRANTED`/`ROLE_REVOKED` | Zamyka A6, A10 i P13; nadanie uprawnień admina ma ślad | Plan |
| Przy okazji | Bramka maila o blokadzie liczy `FAILED`; `partial`/`skipped` jako `error`; zły adres nie zwalnia znacznika; mail o dostępie powiązany z id audytu | Kod i tak jest dotykany; usuwa powtórzenia i fałszywe alarmy | Plan |
| Kiedy migracja | Jedna, w ostatniej fazie | `lessons.md`; lokalne e2e synchronizują bazę dev, CI buduje schemat z migracji | Research |

## Scope

**In scope:**
- `MailOutcome` i jego wywołujący;
- bramka maila o blokadzie;
- `job_run.failure`, kroki trzech jobów, liczniki przypomnień i cyklu życia;
- zaległe testy S-11;
- nowe akcje i kolumny `admin_audit`;
- CLI ról;
- migracja, `backend-patterns.md`, `CLAUDE.md`.

**Out of scope:**
- format logu i access log (S-14);
- wiersze dla `role_missing` i 409;
- zapis `q`;
- widok audytu w UI;
- `messageId` i odbicia (J12);
- PENDING i shutdown hooks (L9);
- indeksy na `admin_audit`;
- zmiany we froncie.

## Architecture / Approach

Fazy idą według modułów. Faza 1 ustala kontrakt `MailService`, z którego korzystają przypomnienia w fazie 2. W fazie 2 `JobStepError` i helper `failureCodeOf` (`shared/database/`) dają `track` krok i kod. Faza 3 rozszerza `admin_audit`: `details` jsonb, kolumny id nullable, zapis poza transakcją dla `DENIED`. Faza 4 generuje jedną migrację, która tylko rozszerza schemat, i wdraża.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Wynik wysyłki maila | `MailOutcome`, `lookup_failed` z wierszem i alarmem, bramka | ~15 testów przypina dzisiejszy `boolean` i regułę „błąd = brak konta” |
| 2. Przyczyny porażek jobów | `failure`, kroki, liczniki pominiętych i straconych, testy S-11 | Zmiana liczenia `usersFailed` zmienia, kiedy przebieg jest `partial` |
| 3. Ślad audytowy | `SEARCH`, `DENIED`, `ACCOUNT_DELETED`, `ROLE_*`, CLI | `DENIED` musi przeżyć wycofanie transakcji, a 403 i linia `Denials` zostają bez zmian |
| 4. Migracja, dokumenty i produkcja | Migracja, wzorce, deploy | Migracja wchodzi w oknie deployu; poprzednie wydanie musi działać na nowym schemacie |

**Prerequisites:** S-11, S-12, S-13 na `main` (spełnione); lokalne `subtracker-db` i `subtracker-db-dev`.
**Estimated effort:** ~3–4 sesje w 4 fazach.

## Open Risks & Assumptions

- Zakładamy, że UUID usuniętego konta w `admin_audit` jest dopuszczalny (precedens S-09). Zmiana tej oceny oznacza usuwanie wierszy przy usunięciu konta.
- `lookup_failed` zapisuje adres w wierszu `FAILED` tylko wtedy, gdy drugi odczyt konta potwierdzi, że konto istnieje. W przeciwnym razie wiersz jest anonimizowany.
- Poziom `error` dla `partial` i `skipped` może się zmienić przy formacie logu w S-14.

## Success Criteria (Summary)

- Operator rozróżnia w logu, w alarmie i w `job_run` brak konta, blokadę, błąd bazy i błąd SMTP oraz wie, który krok joba padł.
- Usunięcie konta, wyszukiwanie, odmowa rangi i zmiana roli mają wiersz w `admin_audit` bez danych osobowych.
- Zaległe testy z S-11 są dopisane, CI zielone, a joby na produkcji następnego dnia kończą się `success`.
