---
date: 2026-11-24T15:10:47+01:00
researcher: Claude (Opus 5.5) z Jakubem Pietrzykowskim
git_commit: deadefe51aa6512a45c8822218e3a812f976a776
branch: change/failure-causes-and-audit-trail
repository: 10xProject
topic: "S-16: przyczyny porażek jobów i maili oraz ślad audytowy (FR-024)"
tags: [research, backend, mail, jobs, job-run, admin-audit, account-deletion, role-script, watchdog]
status: complete
last_updated: 2026-11-24
last_updated_by: Claude (Opus 5.5)
---

# Research: S-16 — przyczyny porażek jobów i maili oraz ślad audytowy

**Date**: 2026-11-24T15:10:47+01:00
**Researcher**: Claude (Opus 5.5) z Jakubem Pietrzykowskim
**Git Commit**: deadefe (origin/main po archiwizacji S-12)
**Branch**: change/failure-causes-and-audit-trail
**Repository**: 10xProject

## Research Question

FR-024 (`context/foundation/prd.md:124`) i ustalenia audytu `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` z §6 pkt 6–7: J5, J7, J8, J9, J11, J15, L8, A3, A5, A6, A7, A8, do tego A1. W stanie kodu po S-11, S-12 i S-13 trzeba ustalić:

- które ustalenia są nadal otwarte;
- gdzie dokładnie spłaszczane są przyczyny porażek;
- gdzie brakuje śladu audytowego;
- które testy przypinają obecne zachowanie;
- które zaległe testy z przeglądów S-11 trzeba dopisać.

Drobne poprawki z §6 pkt 8 wchodzą tylko tam, gdzie slice i tak dotyka kodu.

Ścieżki kodu w tym dokumencie są względne do `backend-subtracker/src/`, o ile nie zaznaczono inaczej.

## Summary

- **Maile.**
  - `MailService.sendToUser` zwraca `Promise<boolean>` (`mail/services/mail.service.ts:64-86`). Cztery przyczyny dają to samo `false`:
    - brak konta;
    - konto zablokowane;
    - błąd bazy przy sprawdzaniu konta;
    - błąd SMTP: literówka albo inny.
  - Trzy pierwsze zostawiają jeden mylący `warn` „no account with this address” (:71-73), bez wiersza `mail` i bez alarmu.
  - Błąd bazy jest celowo traktowany jak brak konta (`accountExists`, :151-160). Tę regułę zapisuje wprost `backend-patterns.md` (sekcja „Mail tylko na adres istniejącego konta”), więc zmiana musi ją przepisać.
  - Wynik ignorują wszyscy wywołujący oprócz przypomnień.
  - Otwarte są L8, A5, J11 i J15.
- **Joby.**
  - `JobRunService.track` (`jobs/job-run.service.ts:48-105`) zapisuje wynik i liczniki. Przy `failed` zostaje tylko `error.message` w jednej linii logu (:66, :86), a w bazie nic.
  - Encja `job_run` nie ma kolumny na przyczynę ani krok (`jobs/entities/job-run.entity.ts`).
  - S-11 świadomie odłożył rozbicie przyczyn i UUID użytkownika do S-16 (`context/archive/2026-11-22-operator-liveness-alerts/plan.md:44`).
  - Otwarte są J5, J7, J8, J9, J13 i J15.
- **Ślad audytowy.** `admin_audit` zapisuje `VIEW`, `BLOCK`, `UNBLOCK` i `RESET_SESSIONS` (`admin/admin-audit.types.ts:2-8`). Brakuje śladu dla trzech rzeczy:
  - odmów (wiersz wycofuje się razem z transakcją akcji, A1);
  - wyszukiwania (A7);
  - usunięcia konta (A3).

  CLI ról zgłasza „granted/revoked” także wtedy, gdy nic się nie zmieniło. Nie sprawdza, czy rola jest aktywna, i nie zostawia śladu (A6).

  S-13 zamknął w A1 tylko część „brak linii logu”. Trwały wiersz zostawił do S-16 (`context/archive/2026-11-23-request-context-and-denial-reasons/plan.md:71`).
- **Zaległe testy z S-11** są nadal do zrobienia:
  - ścieżka „poprzedni przebieg trwa” w trzech schedulerach;
  - granica 12 h w `watchdog/watchdog-policy.spec.ts` z dosłownymi czasami.
- **Nowe znalezisko spoza audytu.** Bramka „mail o blokadzie najwyżej raz na godzinę” sprawdza tylko wiersze `SENT` (`auth/services/auth.service.ts:340-351`). Przy awarii SMTP każde żądanie linku dla zablokowanego konta wysyła więc mail ponownie, a alarm hamuje tylko okno 15 min z S-12.

## Detailed Findings

### 1. Wynik wysyłki maila do użytkownika

- **`sendToUser(type, to, content): Promise<boolean>`** (`mail/services/mail.service.ts:64-86`):
  1. Najpierw `mayReceive` (:142-148). Dla typów z `ACCOUNT_ACCESS_MAIL_TYPES` (ACCOUNT_BLOCKED, ACCOUNT_UNBLOCKED, SESSIONS_RESET; `mail/mail.types.ts:23-27`) pyta o `{ email }`, dla pozostałych o `{ email, isActive: true }`.
  2. Przy `false` wypisuje `warn` „Skipped … no account with this address may receive it” (:71-73) i zwraca `false`. Nie powstaje wiersz `mail` ani alarm.
  3. W przeciwnym razie woła `deliver` (:106-138). Ta metoda zwraca `{ sent, needsAlert, rowId }`:
     - błąd transportu: wiersz `FAILED`, `logFailure`, `needsAlert = !isRecipientTypo`;
     - sukces: wiersz `SENT`.
- **`accountExists`** (:151-160): gdy `users.exists` rzuci wyjątek, loguje `error` „Checking the account of a mail recipient failed” i zwraca `false`. Przy błędzie bazy w logu są więc dwie linie (`error` i `warn` „no account”), a mail ginie bez wiersza i alarmu. To ustalenia L8, A5 i J11.
- **`saveAudit`** (:181-207): drugi odczyt konta (`{ email }`, bez `isActive`) przed zapisem wiersza. Gdy konta już nie ma, zapisuje `recipient = ANONYMIZED_RECIPIENT` i `error_message = null`. Błąd zapytania w tym miejscu też kończy się anonimizacją: jest linia `error`, ale nic nie mówi, że to był błąd bazy.
- **Encja `mail`** (`mail/entities/mail.entity.ts`):
  - kolumny: `id`, `type` varchar(30), `recipient` varchar(254) z indeksem, `status` varchar(10), `error_message` varchar(500), `created_at`, `sent_at`;
  - brak `user_id`, FK i kolumny przyczyny;
  - `MailStatus` to `SENT | FAILED` (`mail/mail.types.ts:14-17`).
- **Log porażki SMTP (L10)** jest zamknięty przez S-12: `logFailure` (:164-176) z `smtpFailureDetails` (`mail/smtp-error.ts:55-62`) podaje kod i rozszerzony status oraz id wiersza audytu. Nie podaje id konta.
- **Wywołujący `sendToUser`:**
  - `auth/services/auth.service.ts` `sendLink` (:310-325, z :103 i :128) i `sendBlockedMail` (:328-336): fire-and-forget przez `fireAndForget` (:354-360), wynik ignorowany.
  - `auth/services/account-access.service.ts` `notify` (:166-181, z :73, :99, :122): wysyłka po commicie, bez `await`, z `.catch` na log. Wynik ignorowany.
  - `subscriptions/services/trial-reminder.service.ts:147-169`:
    - `true` daje liczbę pozycji;
    - `false` zwalnia znacznik i daje `0`, co `sendDue` liczy jako `usersFailed += 1` (:104-109).
- **J15.** Konto zablokowane albo usunięte w oknie między rezerwacją (:124-135) a `mayReceive` daje `false`. Liczy się wtedy do `usersFailed`, przebieg dostaje `partial` (`subscriptions/trial-reminder.scheduler.ts:181`), a operator alarm. Konto zablokowane przed rezerwacją odpada w warunku `OWNER_IS_ACTIVE` (wynik `null`, nie jest porażką).
- **J14.** Literówka w adresie przy przypomnieniu daje kilka skutków:
  - wiersz `FAILED`;
  - `warn` bez alarmu z `MailService`;
  - zwolnienie znacznika i `usersFailed++`, więc przebieg kończy się `partial` z alarmem jobu.

  Powtarza się przy każdym przebiegu, aż trial wyjdzie z okna 7 dni.
- **A8.**
  - `notify` dostaje tylko adres.
  - Wiersz `mail` nie ma id konta ani id audytu.
  - `admin_audit` ma tylko id (`admin/entities/admin-audit.entity.ts:12-28`).

  Wynik maila da się więc powiązać z akcją admina tylko heurystycznie: typ, czas i bieżący adres.
- **Nowe znalezisko.** `blockedMailSentRecently` (`auth/services/auth.service.ts:340-351`) szuka wiersza `ACCOUNT_BLOCKED`, `status = SENT` z ostatniej godziny. Mail nieudany (`FAILED`) albo pominięty (bez wiersza) bramki nie zamyka.

### 2. Joby i rejestr przebiegów

- **`JobRunService.track(job, trigger, run)`** (`jobs/job-run.service.ts:48-105`):
  - `recordStart` (:145-180) zapisuje wiersz z `outcome = null`;
  - `run()` zwraca `JobRunReport { counters, partial? }` (`jobs/job-run.types.ts:24-28`);
  - wynik to `partial`, `success` albo `failed` przy wyjątku (:59-67);
  - z wyjątku zostaje tylko `messageOf(error)` (:23-25, :66);
  - `recordFinish` (:182-204) zapisuje `finishedAt`, `outcome` i `counters`, bez błędu.
- **Log** (:82-91): jedna linia `Job <job> (<trigger>) for <day>: <outcome> in <ms> ms, k=v…`. Poziom zależy od wyniku:
  - `failed`: `error` z `: <message>`;
  - `partial`: `warn`;
  - `success`: `log`.
- **Mail do operatora** (:93-104): przy każdym wyniku innym niż `success`. Treść daje `jobs/job-run-alert.ts:22-42` (bez treści błędu). Zdanie dla `partial` (:16-17) mówi „zostanie ponowiona w kolejnym przebiegu”, co przy J5 jest nieprawdą.
- **Encja `job_run`** (`jobs/entities/job-run.entity.ts`):
  - kolumny: `id`, `job`, `trigger`, `started_at`, `finished_at`, `outcome`, `counters jsonb`;
  - indeks `(job, started_at)`;
  - komentarz zastrzega brak danych użytkowników;
  - nie ma kolumny na przyczynę ani krok.
- **J8.** Wspólna linia porażki w `track` (:86) podaje sam `message`: bez kroku, kodu PG (`code`, `routine`) i stosu. Konkretne nazwy kroków znają tylko serwisy.
- **J13.** Nest `ConsoleLogger` pisze `warn` na stdout (`node_modules/@nestjs/common/services/console-logger.service.js:114`), a `error` na stderr (:103). Trafiają tam:
  - podsumowanie `partial` (`warn`, `jobs/job-run.service.ts:88`);
  - trzy linie „Skipped …” przy nakładaniu przebiegów.

  Wszystkie te linie lądują w `out.log`, a nie w `err.log`. Format logu należy do S-14; to ustalenie dotyczy tylko poziomu linii.
- **J9, cykl życia** (`subscriptions/services/subscription-lifecycle.service.ts`):
  - kroki 1 (:30-37) i 2 (:39-48) to osobne `UPDATE`;
  - krok 3 `rollBillingDates` (:59-97) to `getMany` i pętla z `UPDATE` per wiersz (:77-95), bez `try/catch`;
  - wyjątek na wierszu N przerywa przebieg, a liczniki są zwracane tylko na końcu (:50-54), więc przy `failed` `counters = null`;
  - nie ma id wiersza, a ten sam wiersz wywraca każdy kolejny przebieg.
- **Sprzątanie auth** (`auth/services/auth-cleanup.service.ts:123-133`): trzy `DELETE` bez nazwanych kroków. Błąd trafia do `track` jako samo `message`.
- **Przypomnienia** (`subscriptions/services/trial-reminder.service.ts`):
  - `remind` (:123-170) ma trzy kroki: rezerwację, `sendToUser` i warunkowe zwolnienie;
  - `catch` w `sendDue` (:110-116) loguje „Trial reminder for one user failed: <message>” bez UUID użytkownika i bez kroku (J7) i robi `usersFailed++`;
  - błąd zwolnienia jest liczony jak zwykła porażka. Znacznik zostaje, więc przypomnienie o tej dacie końca nie wyjdzie, a alarm mówi „zostanie ponowiona” (J5).

  `backend-patterns.md` („Cykl życia i zadania cykliczne”) opisuje ryzyko błędu zwolnienia jako przyjęte świadomie, ale bez osobnego sygnału.

### 3. Ślad audytowy

- **`admin_audit`** (`admin/entities/admin-audit.entity.ts:12-28`, migracja `database/migrations/1795264062710-AdminRolesAndAudit.ts:10`):
  - kolumny: `id`, `actor_id` NOT NULL, `target_id` NOT NULL, `action` varchar(30), `created_at`;
  - brak FK (wiersze przeżywają usunięcie konta, zgodnie z wyjątkiem w `backend-patterns.md`), brak indeksów, brak kolumny wyniku i kontekstu;
  - `action` to varchar, a enum istnieje tylko w TS, więc nowa wartość nie wymaga migracji.
- **Zapis wiersza audytu:**
  - `record(manager, …)` (`admin/services/admin-audit.service.ts:16-25`) w transakcji akcji;
  - `recordView` (:30-38) poza transakcją (`INSERT … WHERE EXISTS`);
  - akcje przechodzą przez hook w `AccountAccessService.change` (`auth/services/account-access.service.ts:130-147`): sprawdzenie rangi (`admin/services/admin-users.service.ts:188-199`), potem `record` (:200).

  Przy 403 (ranga) i 409 (stan, `account-access.service.ts:144`) transakcja wycofuje się razem z wierszem (komentarz `admin-users.service.ts:174-177`).
- **A1 po S-13.**
  - `RolesGuard` (`shared/guards/roles.guard.ts:32-37`) daje `role_missing` z `actor`.
  - Odmowa rangi `admin_cannot_manage` (`admin-users.service.ts:39, 190-198`) ma `actor`, `target`, `action` i `why`.
  - Obie dają linię `warn` w kontekście `Denials` z filtra, z limitem 10 na kod na minutę (`shared/filters/safe-logging-exception.filter.ts:22, 114-122, 157-178`).
  - Nie ma trwałego wiersza.
  - 409 (stan) i 404 (nieznane id) nie są logowane.
  - `role_missing` nie ma celu, a `target_id` jest NOT NULL.
- **A7.**
  - Endpoint: `GET /admin/users` (`admin/controllers/admin-users.controller.ts:27-34`).
  - Parametry z `admin/dtos/search-users.dto.ts:19-35`: `q` 3–254 znaki, wymagany, chyba że `status=blocked`; `status` z wartościami `all|active|blocked`.
  - Wynik: limit 20 (`admin/admin-user.types.ts:9`).
  - Nic nie jest zapisywane ani logowane.
  - `q` jest fragmentem adresu, czyli danych osobowych.
- **A3.**
  - `auth/services/account-deletion.service.ts:18-45` działa w jednej transakcji: blokada wiersza `user`, kontrole (401, 400), anonimizacja `mail` (:37-42), `DELETE user` (:43).
  - Udane usunięcie nie zostawia logu ani rekordu.
  - Kontroler: `auth/controllers/auth.controller.ts:101-110`.
- **A6, A10 i P13, CLI ról:**
  - `cli/role-script.ts:44` po każdym przebiegu bez wyjątku wypisuje `Role X granted to/revoked from <email>`;
  - `catch` (:51-62) wypisuje sam `error.message`, bez `code` PG (A10);
  - `users/role-grants.ts`:
    - `findGrant` (:22-40) nie sprawdza `role.isActive` ani `user.isActive`;
    - `grantRole` (:45-76) robi `ON CONFLICT DO NOTHING` bez `RETURNING`, więc rola już nadana daje „granted”;
    - `catch` zamienia `23505` na nowy `Error` bez `cause` (P13);
    - `revokeRole` (:80-89) nie sprawdza `affected`.
  - `user_role.granted_by` (`users/entities/user-role.entity.ts:34-38`) zostaje puste (`backend-patterns.md`, role), a odebranie roli usuwa wiersz bez śladu.

### 4. Zaległe testy z S-11

- **„Poprzedni przebieg trwa”:**
  - Nie ma plików `*scheduler*.spec.ts`. `recordSkipped` jest testowany tylko w serwisie (`jobs/job-run.service.spec.ts:262-292`), bez flagi `running`.
  - Schedulery są testowane w e2e `backend-subtracker/test/jobs/job-run.e2e-spec.ts`:
    - `daily()` (:95-107);
    - porażka przez `vi.spyOn(…, 'advance').mockRejectedValueOnce` (:109-152);
    - `partial` przez `e2e.failMailTo` (:155-…);
    - wiersze przez `runsSince` (:35-39).
  - Wzorzec do skopiowania: `mockImplementationOnce(() => gate)`, `daily()` bez `await`, drugie `daily()`, sprawdzenie wiersza `skipped`, puszczenie `gate`.
  - Dla przypomnień dodatkowo trzeba sprawdzić, że drugie wywołanie i `idle()` rozwiązują się dopiero po pierwszym (`subscriptions/trial-reminder.scheduler.ts:160-173`).
- **Watchdog, granica 12 h** (`watchdog/watchdog-policy.spec.ts`):
  - testy :71-84 i :86-105 (oraz `keepUnsent` :162) liczą czas ze stałej `REMIND_EVERY_HOURS`;
  - wartość przypina tylko :32-35;
  - helper `at(minutes)` jest w :12-14;
  - nowe przypadki: `at(11 * 60 + 59)` daje `none`, a `at(12 * 60)` daje `remind-down`, w `describe('decide')` po :105;
  - warunek, który testują, jest w `watchdog/watchdog-policy.ts:45` (`>=`).

### 5. Testy przypinające dzisiejsze zachowanie (do zmiany przy enumie wyniku)

- `mail/services/mail.service.spec.ts`:
  - :102, :125, :180, :445, :457;
  - blok :469-600, w tym :523 (jeden `warn` z „no account”) i :539 „treats a failed account lookup as a missing account” — ten test przypina L8.
- Mocki z `Promise<boolean>`:
  - `auth/services/auth.service.spec.ts:147-167` (także :226, :312);
  - `auth/services/account-access.service.spec.ts:82-93`.
- E2E w `backend-subtracker/test/`:
  - `subscriptions/trial-reminder.e2e-spec.ts:167, 221`;
  - `jobs/job-run.e2e-spec.ts:155`;
  - `auth/account-access.e2e-spec.ts:121-145` (bramka `SENT`);
  - `auth/privacy-validation.e2e-spec.ts:61`;
  - `auth/account-deletion.e2e-spec.ts:159, 208-213`;
  - `auth/sign-in.e2e-spec.ts:211`.
- Helper e2e `failMailTo` (`backend-subtracker/test/support/e2e-app.ts:148-152, 224-231`) odrzuca wysyłkę błędem `Error('connection refused')` bez pól SMTP, czyli jak awarię serwera.
- Nie ma unit testu `TrialReminderService`. Plik `subscriptions/trial-reminder.spec.ts` testuje czyste funkcje.

## Code References

- `mail/services/mail.service.ts:64-86` — `sendToUser`, wynik `boolean`
- `mail/services/mail.service.ts:142-160` — `mayReceive`, `accountExists` (błąd bazy → `false`)
- `mail/services/mail.service.ts:181-207` — `saveAudit`, drugi odczyt i anonimizacja
- `mail/mail.types.ts:14-27` — `MailStatus`, `ACCOUNT_ACCESS_MAIL_TYPES`
- `auth/services/auth.service.ts:310-360` — linki, mail o blokadzie, bramka `SENT`, `fireAndForget`
- `auth/services/account-access.service.ts:130-181` — transakcja akcji admina, `notify`
- `subscriptions/services/trial-reminder.service.ts:82-170` — `sendDue`, `remind` (J5, J7, J15)
- `subscriptions/services/subscription-lifecycle.service.ts:30-97` — kroki cyklu życia (J9)
- `auth/services/auth-cleanup.service.ts:123-133` — trzy `DELETE`
- `jobs/job-run.service.ts:23-25, 48-126, 145-204` — `track`, log, alarm, `recordSkipped`
- `jobs/job-run-alert.ts:16-42` — treść alarmu jobu
- `jobs/entities/job-run.entity.ts` — kolumny rejestru
- `admin/entities/admin-audit.entity.ts:12-28`, `admin/admin-audit.types.ts:2-8`, `admin/services/admin-audit.service.ts:16-38`
- `admin/services/admin-users.service.ts:99-134, 174-203` — wyszukiwanie, podgląd, hook rangi
- `auth/services/account-deletion.service.ts:18-45` — usunięcie konta
- `cli/role-script.ts:16-62`, `users/role-grants.ts:22-89` — CLI ról
- `watchdog/watchdog-policy.spec.ts:12-14, 32-35, 71-105, 162`; `watchdog/watchdog-policy.ts:45`

## Architecture Insights

- `job_run` i `admin_audit` celowo nie zawierają danych osobowych ani FK. UUID nie jest uznawany za dane osobowe (`backend-patterns.md`; audyt J7). Logi i maile operatora zawierają tylko UUID, kody i liczniki, nigdy adres ani token (S-13, „Logi błędów i odmów”).
- Odmowy HTTP loguje wyłącznie filtr przez `withDenial`. Maile i joby logują własnym `Logger` serwisu; limit linii odmów ich nie dotyczy.
- Wartości `admin_audit.action` i `job_run.outcome` to varchar, a enumy istnieją tylko w TS. Nowa wartość akcji nie wymaga więc migracji. Migracji wymaga nowa kolumna albo zmiana NOT NULL (`lessons.md`: migracja generowana na koniec).
- Helper wyciągający `code` i `routine` z błędu PG to kod bez wiedzy o domenie, więc należy do `shared/database/` (`lessons.md`). Najpierw trzeba sprawdzić, czy podobny helper już tam jest, np. ten rozpoznający `23505`.
- `counters` w `job_run` to `Record<string, number>`. Nowy licznik, np. `usersSkipped`, nie wymaga zmiany schematu.

## Historical Context (from prior changes)

- `context/archive/2026-11-22-operator-liveness-alerts/plan.md:44` — rozbicie przyczyn i UUID użytkownika w logach jobów świadomie przeniesione do S-16. Wspiera to zakres tego slice'u.
- `context/archive/2026-11-22-operator-liveness-alerts/plan.md:45` — format logu należy do S-14. J13 dotyczy tylko poziomu linii (`warn` czy `error`), nie formatu.
- `context/archive/2026-11-23-request-context-and-denial-reasons/plan.md:71` — wiersz `DENIED` w `admin_audit` oraz ślad usunięcia konta i wyszukiwań to S-16.
- `context/archive/2026-11-21-admin-account-management/plan.md:55-58, 146-155` — audyt objął `VIEW` i akcje. W „What We're NOT Doing” (:74-84) wyszukiwanie nie jest wymienione, więc nie znaleziono świadomej decyzji o jego pominięciu (sprawdzono grepem, bez `reviews/`).
- `context/archive/2026-11-21-admin-account-management/plan.md:58, 148` — UUID aktora i celu zostają w `admin_audit` po usunięciu konta. To jedyny precedens zachowania UUID usuniętego konta.
- `context/archive/2026-11-20-account-deletion/plan.md:36-46` — usunięcie bez karencji i bez maila. Wiersze `mail` są anonimizowane stałym znacznikiem, nie pseudonimizowane („pseudonimizacja w małej bazie nadal wskazuje osobę”, :38). Nie znaleziono decyzji o śladzie usunięcia ani o zachowaniu `user_id` po usunięciu.
- `context/archive/2026-11-23-independent-alert-channel/` — S-12 zamknął L2, L3, J6, J10 i L10. Okno alarmu o nieudanej wysyłce jest osobne dla każdego typu, a literówka to tylko statusy 5.1.1, 5.1.2, 5.1.3, 5.1.6 i 5.1.10.

## Related Research

- `context/archive/2026-11-20-account-deletion/research.md` — usuwanie konta i anonimizacja (S-10).
- Pozostałe archiwa S-09, S-11 i S-13 przeszukano grepem tylko w zakresie powyższych decyzji.

## Open Questions

Decyzje produktowe dla `/10x-plan`:

1. **Ślad usunięcia konta (A3).** Do wyboru:
   - sama linia logu `Account <uuid> deleted`;
   - trwały rekord `(user_id, deleted_at)`.

   Pytanie RODO: czy wolno zachować UUID usuniętego konta? Precedens z S-09 (`admin_audit`) mówi tak, ale decyzji dla samego usunięcia nie ma.
2. **Ślad wyszukiwania (A7).** Jaki kontekst zapisać bez `q`, który zawiera fragment adresu? Na przykład `status`, długość albo obecność `q` i liczbę wyników. Do tego potrzebne jest miejsce na ten kontekst: `admin_audit` nie ma kolumny kontekstu, a `target_id` jest NOT NULL.
3. **Trwałe odmowy (A1).** Do ustalenia:
   - które odmowy zapisywać: rangę, rolę, stan 409;
   - gdzie je zapisać: wiersz poza wycofywaną transakcją;
   - czy linia `Denials` z S-13 wystarczy dla `role_missing` (brak celu).
4. **Przyczyna porażki joba.** Do wyboru:
   - nowa kolumna w `job_run`, np. krok i kod błędu bez danych (wymaga migracji);
   - tylko lepsza linia logu z krokiem, kodem PG i stosem.
5. **Wynik `sendToUser`.** Enum przyczyn, np. `sent | no_account | blocked | lookup_failed | smtp_failed | recipient_typo`. Do tego decyzja, czy błąd bazy przy odczycie konta ma dawać wiersz `FAILED` i alarm, jak proponuje audyt dla L8.
6. **CLI ról (A6).** Uczciwe komunikaty („już nadana”, „nie była nadana”, odmowa roli nieaktywnej) i ślad nadania. Do wyboru:
   - `admin_audit` z aktorem `cli`, co wymaga zmiany typu albo NOT NULL;
   - sama linia na konsoli.
7. **Zakres z §6 pkt 8, który wchodzi przy okazji.** Do ustalenia, które z tych rzeczy plan bierze:
   - J13, poziom `warn`/`error`;
   - J14, pamięć trwale odrzuconego adresu w przypomnieniach;
   - A10 i P13, `code` i `cause` w CLI;
   - bramka maila o blokadzie, która liczy też wiersze `FAILED` (nowe znalezisko).
