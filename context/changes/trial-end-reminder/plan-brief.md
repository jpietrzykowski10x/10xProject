# Przypomnienie przed końcem triala (S-06) — Plan Brief

> Full plan: `context/changes/trial-end-reminder/plan.md`

## What & Why

Użytkownik z subskrypcją w trialu dostaje e-mail, gdy do końca okresu próbnego zostaje 7 dni lub mniej — dokładnie raz na datę końca triala (FR-014). To rdzeń obietnicy produktu („nie przegap końca triala”), a według pre-mortem w `infrastructure.md` także najcichsza możliwa awaria: zgubione albo zdublowane przypomnienie przy restarcie procesu.

## Starting Point

S-05 dał job cyklu życia (00:05 Warszawa + przebieg przy starcie), „dziś” w `Europe/Warsaw` i wzorzec warunkowego `UPDATE`. `MailService` wysyła maile z audytem i alertem operatora, ale nie mówi wywołującemu, czy mail wyszedł. W bazie nie ma żadnego śladu przypomnienia.

## Desired End State

Codziennie o 02:00, a także w tle po każdym starcie API, każdy aktywny użytkownik z trialami kończącymi się w ciągu 0–7 dni dostaje jeden mail zbiorczy (nazwa, data końca, „dziś / jutro / za N dni”, kwota po trialu, link do listy). Drugi przebieg ani restart nie wysyła ponownie. Przesunięcie daty końca w edycji uzbraja przypomnienie od nowa. Błąd SMTP zostawia przypomnienie do ponowienia.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Okno wysyłki | `dziś ≤ trial_end_date ≤ dziś + 7`, mail podaje faktyczną liczbę dni | Nadrabia pominięte dni i obejmuje triale dodane już w oknie — to wciąż przed obciążeniem karty. |
| „Dokładnie raz” | Znacznik `trial_reminder_sent_for` = data końca, dla której wysłano | Zmiana daty sama uzbraja przypomnienie, bez logiki w `PUT`, akcjach i jobie cyklu życia. |
| Błędy wysyłki | Rezerwacja → wysyłka → zwolnienie po błędzie | Nigdy dwa maile, a błędy SMTP są ponawiane; pad procesu w tej chwili gubi paczkę jednego użytkownika. |
| Kształt maila | Jeden mail zbiorczy na użytkownika na przebieg | Mniej maili w skrzynce przy kilku trialach naraz (wybór użytkownika). |
| Godzina | Stała 02:00 `Europe/Warsaw`, własny scheduler | Osobny od joba cyklu życia; zmiana czasu jest nieszkodliwa dzięki znacznikowi. |
| Start aplikacji | Przebieg w tle, bez `await` | Wysyłka SMTP nie może opóźnić health-checku deployu i wywołać przywrócenia dumpu. |
| Wykrywanie pominięć | Audyt `TRIAL_REMINDER`, istniejący alert SMTP, log liczb, mail do operatora po błędzie przebiegu | Pokrywa błędy SMTP i joba bez nowej infrastruktury. |
| Zablokowane konta | Bez przypomnień (`is_active = false`) | Konto zablokowane nie korzysta z aplikacji. |

## Scope

**In scope:** kolumna + migracja, `MailType.TRIAL_REMINDER`, `sendToUser` → `boolean`, `addDays`/`daysBetween` w `shared/date`, szablon maila zbiorczego, serwis i scheduler joba, poprawka pomocnika e2e (`close()` tylko dla adresów pliku, `failMailTo`), e2e joba, dokumentacja wzorca.

**Out of scope:** monitoring niedziałającego procesu i raport triali bez przypomnienia, ustawienia przypomnień per użytkownik, zmiany we frontendzie, konfigurowalna godzina, osobne traktowanie trwale odrzuconego adresu, FR-015.

## Architecture / Approach

`TrialReminderScheduler` (cron 02:00 + start w tle, flaga `running`, oczekiwanie na przebieg przy zamknięciu) woła `TrialReminderService.sendDue(today)`. Serwis odczytuje użytkowników z zaległymi trialami, a dla każdego warunkowym `UPDATE … RETURNING` rezerwuje jego wiersze, buduje mail czystą funkcją `trialReminderMail` i wysyła przez `MailService`. Gdy mail nie wyszedł, zwalnia rezerwację (`SET NULL` z warunkiem na zarezerwowaną datę).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Elementy bazowe | Kolumna, migracja, typ maila, wynik wysyłki, funkcje dni, szablon (testy jednostkowe) | Zmiana kontraktu `sendToUser` przeoczona w testach `MailService` |
| 2. Job przypomnień | Serwis z rezerwacją/zwolnieniem, scheduler, poprawka pomocnika e2e, e2e joba | Przebieg przy starcie w e2e i w bazie dev wysyła maile innym kontom — stąd zawężony `close()` |
| 3. Dokumentacja i weryfikacja ręczna | `backend-patterns`, `test-plan` §6/§7, `CLAUDE.md`, mail w Gmailu, deploy | Dostarczalność przez współdzielone IP MyDevil |

**Prerequisites:** S-05 scalone (jest na `main`), lokalny Postgres i `.env` z `MODE=DEV`.
**Estimated effort:** ~2–3 sesje w 3 fazach.

## Open Risks & Assumptions

- Pad procesu dokładnie między rezerwacją a wysyłką gubi przypomnienia jednego użytkownika (ślad: znacznik bez wiersza audytu); świadomie zaakceptowane.
- Przywrócenie bazy z dumpu kasuje znaczniki z nowszej wersji, więc maile mogą wyjść drugi raz.
- Trwale odrzucony adres jest ponawiany codziennie do końca triala (tylko ostrzeżenia w logu).
- Lokalny `start:dev` z ustawionym SMTP wyśle prawdziwe przypomnienia na konta w `subtracker-db-dev`.

## Success Criteria (Summary)

- Użytkownik dostaje jeden czytelny mail o trialach kończących się w ciągu 7 dni, a restart ani drugi przebieg go nie dublują.
- Przesunięcie daty końca triala daje nowe przypomnienie; chwilowa awaria SMTP go nie gubi.
- Deploy API nie czeka na wysyłkę maili.
