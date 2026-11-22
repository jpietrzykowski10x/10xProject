---
type: observability-audit
date: 2026-11-22 11:46
mode: audit
commit: be499ad
branch: chore/10x-m3-observability
dirty_tree: false
areas: [sign-in, subscriptions-budget, jobs-mail, account-admin]
area_source: foundation
runtime_proof: not-run
error_tracker: none (logi procesu przez forever, mail do operatora)
previous_report: null
findings: { critical: 4, high: 15, medium: 29, low: 14 }
---

# Audyt obserwowalności — logowanie, subskrypcje i budżet, joby i maile, konto i admin (2026-11-22)

## 1. TL;DR

- **Proces i joby nie dają sygnału życia.** Joby logują tylko, gdy coś zmieniły, nie zapisują przebiegów, a padnięcie procesu (także pętla restartów `forever`) nie wywołuje żadnego alarmu. Zepsuty job, dzień bez pracy, cron, który nie ruszył, i leżące API wyglądają w logach tak samo: cisza. To kodowa przyczyna otwartego pytania roadmapy #3.
- **Każde 4xx jest z założenia niewidoczne.** Filtr wyjątków nie loguje żadnego `HttpException`, więc systemowa usterka, która kończy się 401/403/400 (zegar przy weryfikacji linku, zła lista `CORS_ORIGINS` → CSRF 403, rozjazd walidacji frontu i API), nie zostawia ani jednej linii — użytkownicy widzą „nieprawidłowy link” albo „sprawdź pola”.
- **Linie błędów 5xx nie mają kontekstu.** Brak trasy, metody, użytkownika, identyfikatora żądania i wersji (SHA); brak access logu; domyślny logger Nest z kodami ANSI i lokalnym znacznikiem czasu.
- **Jedyny kanał alarmowy jest wąski i dzieli awarię z tym, co pilnuje.** Mail do operatora idzie domyślnie tym samym SMTP co maile do użytkowników, blokada 15 min ustawia się przed wysyłką, a odrzucenie adresata (także 5.7.1 relay/limit) w ogóle nie alarmuje.
- **Przeglądarka jest czarną skrzynką.** Guardy i formularze zamieniają każdy błąd HTTP na stan UI (`/unavailable`, strona gościa, „sprawdź pola”) bez zapisu nawet w konsoli; błąd nawigacji w SSR kończy się 404.
- Najważniejsza konsekwencja: **API może leżeć w pętli restartów, a job cyklu życia może nie działać tygodniami, i pierwszym sygnałem będzie zgłoszenie użytkownika.**

## 2. Capture model

- **Środowisko:** dwa długo działające procesy Node 24 na MyDevil (FreeBSD) pod `forever` — API NestJS 12 i serwer SSR Angular 22 (Express 5). `forever` zapisuje stdout/stderr do `~/apps/subtracker/<app>/logs/{out,err,forever}.log` (`deploy/mydevil/start-app.sh:31-43`), restartuje proces po wyjściu (`--minUptime 5000 --spinSleepTime 10000`).
- **Tracker błędów:** brak (żadnego SDK w obu aplikacjach). „Przechwycone” znaczy tu: użyteczna linia w `err.log`/`out.log`.
- **Granica API:** globalny `SafeLoggingExceptionFilter` (`backend-subtracker/src/app.module.ts:51`, `src/shared/filters/safe-logging-exception.filter.ts`). `HttpException` → domyślna odpowiedź Nest, bez logu (`:40-43`). Inne błędy → 5xx (albo status body-parsera) i log `message (code: X)` + stos, gdy `LOG_ERROR_STACKS` (domyślnie `true`, `src/config/env.ts:229`) (`:50-61`). Błędy < 500 celowo nie są logowane (PII i rozrost logu). Filtr nie używa `host` do logowania — brak trasy/użytkownika.
- **Poza granicą:** joby `@nestjs/schedule` (`subscription-lifecycle.scheduler.ts`, `trial-reminder.scheduler.ts`, `auth-cleanup.scheduler.ts`) mają własne `try/catch` i logują sam `error.message`. Brak `process.on('unhandledRejection'|'uncaughtException')` i `enableShutdownHooks` (`src/main.ts`). Wysyłka maili po odpowiedzi 202 jako fire-and-forget (`auth.service.ts:300-306`).
- **Alarmy w kodzie:** (1) `TrialReminderScheduler` → `MailService.notifyOperator` przy nieudanym całym przebiegu (`trial-reminder.scheduler.ts:88-99`); (2) `MailService` → mail do operatora przy nieudanej wysyłce maila do użytkownika (poza odrzuceniem adresata), najwyżej raz na 15 min na proces (`mail.service.ts:216-235`). Transport operatora = osobny SMTP tylko, gdy ustawiono `NOTIFICATION_SMTP_*`; inaczej ten sam co dla użytkowników (`mail.transport.ts:102-104`).
- **Logger:** domyślny `ConsoleLogger` (`main.ts:13`): kolory ANSI zależne tylko od `NO_COLOR` (`@nestjs/common/utils/cli-colors.util.js`), lokalny znacznik czasu bez strefy, stos w osobnych liniach, `warn` na stdout (`out.log`), `error` na stderr (`err.log`). TypeORM bez `logging` (`database/database.options.ts`), `statement_timeout` 5 s (`:52`).
- **Frontend:** `provideBrowserGlobalErrorListeners()` (`frontend-subtracker/src/app/app.config.ts:17`) i `bootstrapApplication(...).catch(console.error)` (`src/main.ts:6`) — tylko konsola przeglądarki, nic nie trafia na serwer. SSR: `angularApp.handle(req).then(r => r ? write : next()).catch(next)` (`src/server.ts:61-66`) — błąd renderu do domyślnego handlera Express (stos bez URL), błąd nawigacji → `null` (`@angular/ssr` `hasNavigationError`) → `next()` → 404.
- **Tożsamość wdrożenia:** `deploy.sh` zapisuje SHA do `.deploy-info`, ale żadna aplikacja go nie czyta; linie startowe i `/health` nie mają wersji.
- **Health:** `GET /health` robi tylko `SELECT 1` (`health.controller.ts:25`), loguje i zwraca 503 przy błędzie bazy; sprawdzany wyłącznie przez `deploy.sh` po wdrożeniu.

**Założenia (poza repo, nie ustalenia):**
- Nikt ani nic nie obserwuje plików logów i nie alarmuje z nich — potwierdzone przez użytkownika (brak zewnętrznego trackera, logi przez forever).
- Rotacja i limit rozmiaru logów na MyDevil — niepotwierdzone (pętla restartów mogłaby zapełnić dysk).
- `NODE_ENV=production` we froncie, `TZ` i `NO_COLOR` w `shared/.env` — niepotwierdzone.
- Zewnętrzny monitor dostępności (`/health`) — brak wiedzy, zakładamy brak.
- Czy proxy MyDevil trzyma access log i co pokazuje przy 502 — niepotwierdzone.

## 3. What reaches the logs (statycznie, bez sond)

| Kształt awarii | Odpowiedź | Logi procesu | Alarm | Werdykt |
|---|---|---|---|---|
| Wyjątek w handlerze API (np. błąd SQL) | 500 `Internal server error` | `err.log`: komunikat + kod + stos, bez trasy/użytkownika | brak | słaby |
| `HttpException` 4xx z kodu (401 weryfikacji, 403 rangi, 404) | 4xx | nic | brak | niewidoczny |
| CSRF/Origin odrzucone (`http-security.ts:14`) | 403 | nic | brak | niewidoczny |
| Błąd walidacji DTO | 400 z listą pól | nic | brak | niewidoczny |
| Nieobsłużone odrzucenie / wyjątek procesu | proces pada, 502 z proxy | `err.log`: inspekcja błędu Node bez znacznika czasu (może zawierać parametry zapytania), `forever.log` | brak | słaby, PII |
| Pętla restartów (np. baza nieosiągalna przy starcie) | 502 | powtarzane linie co ~20 s | brak | niewidoczny dla operatora |
| Job cyklu życia pada | — | `err.log`: sam komunikat | brak | słaby |
| Job nie ruszył / proces leżał w oknie | — | nic | brak | niewidoczny |
| Przebieg przypomnień pada w całości | — | `err.log` + mail do operatora | mail | dobry |
| Każdy użytkownik w przebiegu przypomnień pada | — | jedna linia `warn` w `out.log` | brak | słaby |
| Wysyłka maila do użytkownika pada (SMTP) | 202 (już wysłane) | wiersz `mail` FAILED + `err.log` | mail (raz/15 min, tym samym SMTP) | częściowy |
| Odrzucenie adresata 5xx (literówka albo 5.7.1) | 202 | `warn` w `out.log` | brak | słaby |
| Błąd renderu SSR | 500 strona Express | `err.log`: stos bez URL | brak | słaby |
| Błąd nawigacji SSR | 404 | konsola bez URL | brak | mylący |
| Błąd w przeglądarce / chunk po deployu | martwy link, pusta strona | nic | brak | niewidoczny |

## 4. Systemic root causes

1. **„4xx = błąd klienta, nie logujemy”.** `safe-logging-exception.filter.ts:40-43` zwraca każdy `HttpException` bez logu, a `:50` loguje tylko ≥ 500. Decyzja rozsądna lokalnie (PII, rozrost logu przez obcych), ale w aplikacji, w której front waliduje przed wysłaniem, a wiele awarii infrastruktury kończy się 401/403/400, ukrywa całe klasy usterek. Wyjaśnia: L1, L6, L7, S1, S2, S4, S8, A1, A2, P5 (oraz zapas: przyszły 5xx `HttpException` też nie zostanie zalogowany, P12).
2. **Brak sygnału życia procesu i jobów.** Schedulery logują wyłącznie przy niezerowych licznikach (`subscription-lifecycle.scheduler.ts:39-50`, `trial-reminder.scheduler.ts:75`), nie zapisują przebiegów; `main.ts` nie ma handlerów procesu; `/health` (`health.controller.ts:25`) sprawdza tylko `SELECT 1` i to jedynie w `deploy.sh`. Wyjaśnia: J1, J2, J3, P1, P6, S9.
3. **Jedyny kanał alarmowy jest wąski i współdzieli awarię.** `notifyOperator` woła tylko przebieg przypomnień (`trial-reminder.scheduler.ts:95`) i ścieżka nieudanej wysyłki (`mail.service.ts:216-235`); transport operatora domyślnie = transport użytkowników (`mail.transport.ts:102-104`); blokada 15 min ustawiana przed wysyłką (`mail.service.ts:227`); odrzucenie adresata wyłączone z alarmu (`mail.service.ts:132`). Wyjaśnia: J4, J6, L2, L3, J10.
4. **Logi bez kontekstu i z domyślnym formatem.** Filtr loguje `describeError` bez `host` (`safe-logging-exception.filter.ts:56-61`), brak middleware access logu i identyfikatora żądania, `NestFactory.create(AppModule)` bez opcji loggera (`main.ts:13`), SHA z `.deploy-info` nieczytany. Wyjaśnia: P2, P3, P4, J7, J8, L9, A4, S3, S10.
5. **Front zamienia błędy w stany UI bez zapisu.** `auth.guard.ts:50` (`catchError(() => of(true))`) i `:80` (każdy błąd → `/unavailable`), formularze mapują statusy na stałe komunikaty i porzucają `HttpErrorResponse` (`subscription-form.ts:285`, `budget.ts:257`), globalny listener tylko do konsoli, `server.ts:64` zamienia błąd nawigacji SSR w 404. Wyjaśnia: L4, L5, S5, S6, S7, A9, P7, P8.
6. **Booleany i liczniki spłaszczają przyczyny.** `MailService.mayReceive` zamienia błąd bazy w `false` („brak konta”, `mail.service.ts:160` → `:80`), `sendToUser` zwraca jedno `false` dla czterech przyczyn, `usersFailed` miesza „SMTP”, „zwolnienie nie powiodło się” i „konto zablokowane w międzyczasie”. Wyjaśnia: J5, J9, J11, L8, A5.

## 5. Findings by area

Numery linii sprawdzone ręcznie przy pozycjach oznaczonych ✓ (zob. §8); pozostałe pochodzą z raportów audytorów.

### Logowanie (magic link)

| # | Location | Category | Severity | What happens in production | Fix direction |
|---|---|---|---|---|---|
| L1 ✓ | `backend-subtracker/src/auth/services/auth.service.ts:136-138, 146-148, 162-164`; filtr `:40-43` | flattened-response | critical | Każda odmowa weryfikacji (nieznany, użyty, wygasły token, brak użytkownika, wyścig) to gołe 401 bez logu. Systemowa usterka (np. rozjazd zegara: `expiresAt` z `Date.now()` w `:243`, porównanie z `now()` bazy w `:133`/`:158`; zły `FRONTEND_URL`) wygląda jak pomyłki użytkowników — nikt nie wejdzie, logi puste. | Jedna linia `warn` na odmowę z kodem przyczyny (`unknown/used/expired/user_missing/race`) i id wiersza tokenu; bez tokenu i adresu. `expiresAt` liczyć w bazie (`now() + interval`). |
| L2 | `backend-subtracker/src/mail/services/mail.service.ts:41-49, 132` | flattened-response | high | Każde `EENVELOPE` + 5xx przy `RCPT TO` = „literówka”: także 5.7.1 (relay po zmianie hasła), limit wysyłki MyDevil, SPF/DMARC. Wszystkie linki przestają dochodzić, w logu tylko `warn` w `out.log`, bez maila do operatora. | Klasyfikować po rozszerzonym statusie (5.1.1 = zła skrzynka), alarmować przy N odrzuceniach w oknie. |
| L3 ✓ | `mail.transport.ts:102-104`; `mail.service.ts:227` | logged-not-captured | high | Bez `NOTIFICATION_SMTP_*` alarm o awarii SMTP idzie tym samym SMTP i pada tak samo; blokada 15 min ustawia się, zanim alarm zostanie wysłany, więc nieudany alarm wycisza kolejne. | W PROD wymagać osobnego transportu operatora; znacznik czasu dopiero po przyjęciu alarmu; licznik pominiętych. |
| L4 ✓ | `frontend-subtracker/src/app/auth/auth.guard.ts:80-82` | swallowed | high | Każdy błąd `/auth/session` w przeglądarce (CORS = status 0, timeout, rozjazd kontraktu) → `/unavailable` na wszystkich stronach zalogowanego; oba `err.log` puste, nawet konsola przeglądarki pusta. | Minimalny raport klienta (`sendBeacon` do endpointu API: trasa, status, nazwa błędu) i `console.error` w `catchError`. |
| L5 ✓ | `auth.guard.ts:41-51` (`:50`) | swallowed | medium | Gdy SSR nie dosięga API (DNS/TLS z MyDevil, 3 s timeout), zalogowany dostaje stronę gościa, proces frontu nic nie loguje. | `console.error` po stronie serwera (`isPlatformServer`) z nazwą błędu i czasem. |
| L6 | `pages/sign-in/sign-in.ts:56`, `register/register.ts:122`, `verify-link/verify-link.ts:112` | flattened-response | medium | 403 CSRF, 429, błąd sieci i 5xx dają ten sam komunikat; rozjazd DTO (`forbidNonWhitelisted`) daje „nieprawidłowy e-mail” przy każdej rejestracji, bez logu. | Raportować nieoczekiwane statusy tym samym kanałem co L4. |
| L7 | `auth/services/session.service.ts:86-98`, `guards/session-auth.guard.ts` | flattened-response | medium | Pięć przyczyn odrzucenia sesji to jedno 401 / `{user:null}` bez logu; regresja, która wylogowuje wszystkich, widać tylko jako użytkowników odbijanych na `/sign-in`. | `authenticate` zwraca przyczynę; zagregowana linia `info`/`warn` dla „nieznany hash tuż po weryfikacji”. |
| L8 ✓ | `mail.service.ts:160` → `:77-82` | swallowed | medium | Błąd bazy przy sprawdzaniu adresata pomija maila bez wiersza audytu i alarmu, z mylącym `warn` „no account with this address”. Użytkownik dostał już 202. | Odróżnić „błąd odczytu” od „brak konta” i skierować do ścieżki awarii (wiersz FAILED + alarm). |
| L9 | `auth.service.ts:255-306` (fire-and-forget), brak `enableShutdownHooks` | coverage-gap | medium | Restart lub deploy w trakcie wysyłki (timeouty SMTP do ~90 s) gubi maila bez śladu; token jest w bazie, odpowiedź była 202. | Wiersz `mail` PENDING przed wysyłką albo shutdown hooks z oczekiwaniem na wysyłki. |
| L10 | `mail.service.ts:169-182`, `:229-233` | missing-context | medium | Log awarii SMTP ma tylko `code`; `responseCode`, `command` i status rozszerzony giną, alarm ma tylko id i typ. | Dołożyć `responseCode` i `command` (bez adresów) do logu i alarmu. |
| L11 | `mail.transport.ts` (brak `transporter.verify()`) | coverage-gap | low | Złe dane SMTP przechodzą health-check deployu; pierwszy sygnał to nieudany link pierwszego użytkownika. | `verify()` przy starcie z ostrzeżeniem (niefatalnym) albo sonda SMTP w `/health`. |

### Subskrypcje i budżet

| # | Location | Category | Severity | What happens in production | Fix direction |
|---|---|---|---|---|---|
| S1 ✓ | `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:285`; filtr `:40-43` | flattened-response | high | Front wysyła tylko po walidacji, więc 400 to rozjazd reguł (stałe `AMOUNT_MAX`, długości nazw, reguły dat w DTO, nieużywalna kategoria). Użytkownik widzi „Sprawdź pola formularza” przy poprawnych polach, lista pól z API ginie, backend nie loguje — deploy psujący zapis dla wszystkich nie zostawia śladu. | 400 przy poprawnym formularzu traktować jako błąd: raport (status, nazwy pól, trasa); backend loguje 400 z `ValidationPipe` jako nazwy pól bez wartości. |
| S2 ✓ | `frontend-subtracker/src/app/pages/budget/budget.ts:257-260` | flattened-response | high | Każde 400 na stronie budżetu = „lista kategorii się zmieniła” i nadpisanie wpisanych wartości; kategorii nie da się usunąć, więc to zawsze odmowa DTO. Ponowienie daje to samo, nic nie jest logowane. | Komunikat „odrzucone”, zachować wartości, raportować 400 z nazwami pól. |
| S3 | filtr `:56-61`; brak access logu | missing-context | high | Linia w `err.log` (często stos z wnętrza TypeORM/pg) nie mówi, czy padło `/subscriptions`, `/totals` czy `/budget`, jak często i u kogo. | Patrz P2 (kontekst żądania) i P3 (access log). |
| S4 | filtr `:50` (komentarz uzasadnia) | coverage-gap | high | Skok 400/404/409 po deployu jest niewidoczny; tu kończą się S1, S2, S5, S8. | Liczniki 4xx per trasa i status (access log), bez treści. |
| S5 | `subscription-form.ts:245-251` | flattened-response | medium | Odmowa 400 przy tworzeniu własnej kategorii wygląda jak awaria („spróbuj za chwilę”), ponowienie nigdy nie pomoże. | Osobna gałąź 400 z raportem. |
| S6 | `subscriptions/cost-totals.store.ts:45` (gałąź `error`) | flattened-response | medium | Nieudane odświeżenie sum zostawia stare sumy i stary alert budżetu („W normie”) po zmianie, która przekroczyła limit — bez żadnej informacji. | Flaga `refreshFailed` w store i komunikat, jak przy liście. |
| S7 | gałęzie `error:` w `subscription-form.ts`, `subscriptions.ts`, dialogach usuwania i anulowania | swallowed | medium | `HttpErrorResponse` nie trafia ani do `ErrorHandler`, ani do konsoli; 0, 403 CSRF i 500 wyglądają tak samo. | Wspólny helper w każdej gałęzi `error:` (status, URL, `message` API) — dziś konsola, potem endpoint raportów. |
| S8 | `subscriptions.service.ts` (404 dla „cudze” i „usunięte”), `subscriptions.ts` | flattened-response | medium | Błąd zakresu (złe id, pomylony użytkownik) wygląda jak wiersz usunięty w innej karcie: neutralny komunikat i przeładowanie, bez logu. | Liczyć 404 na tych trasach (S4); opcjonalnie `debug` z id. |
| S9 ✓ | `health.controller.ts:25`; `subscription-order.ts` (`COLLATE "pl-PL-x-icu"`) | missing-throw | medium | Po aktualizacji lub przeniesieniu Postgresa bez kolacji ICU `GET /subscriptions` daje 500 wszystkim, a `/health` jest zielony i deploy przechodzi. | `/health` (albo start) sprawdza obecność kolacji w `pg_collation`. |
| S10 | `shared/money/grosze.ts:7-11`, `cost-totals.ts` | missing-context | medium | Jedna kwota w złym formacie (np. wpisana ręcznie SQL-em) daje trwałe 500 na `/subscriptions/totals` danego użytkownika; log ma wartość, ale nie id wiersza ani użytkownika. | Dołożyć id użytkownika i wiersza do błędu albo pominąć wiersz z logiem. |
| S11 | `frontend-subtracker/src/app/shared/grosze.ts:6-9`, `subscription-amounts.ts`, `budget-alert.ts` | missing-throw | low | Zmiana kontraktu API daje wiarygodne, błędne kwoty albo brak ikony alertu, bez błędu. | `console.error` (potem raport) przy wartości spoza kontraktu. |
| S12 | `subscription-form.ts:222-226` (`catchError(() => of([...]))`) | swallowed | low | Nieudany odczyt kategorii po utworzeniu jest maskowany (tylko kolejność), bez śladu. | Zostawić fallback, raportować błąd. |
| S13 ✓ | `categories.service.ts:49`, `cost-totals.ts:89` (`localeCompare(..., 'pl')`) | config | low | Node bez polskich danych ICU sortuje kategorie w kolejności root, bez błędu; CI tego nie sprawdza. | Przy starcie sprawdzić `Intl.Collator.supportedLocalesOf('pl')` i głośno logować. |

### Joby i maile w tle

| # | Location | Category | Severity | What happens in production | Fix direction |
|---|---|---|---|---|---|
| J1 ✓ | `backend-subtracker/src/subscriptions/subscription-lifecycle.scheduler.ts:51-55`; `auth/auth-cleanup.scheduler.ts:43` | coverage-gap | critical | Awaria joba cyklu życia (timeout, schemat po migracji, zły wiersz) powtarza się co noc: triale zostają trialami, anulowania się nie kończą, daty rozliczeń stoją w przeszłości — sumy i alerty budżetu kłamią wszystkim. Sygnał: jedna linia dziennie w `err.log`, bez maila. To samo dla sprzątania auth. | Ten sam mail do operatora co przy przypomnieniach, przez wspólny helper „job failed”. |
| J2 ✓ | `subscription-lifecycle.scheduler.ts:39-50`, `trial-reminder.scheduler.ts:75`, sprzątanie auth | coverage-gap | critical | Joby logują tylko przy zmianach. Przebieg bez pracy, błąd zapytania zwracający 0 wierszy, cron, który nie ruszył, i leżący proces zostawiają ten sam ślad: nic. Brak zapisu „przebieg się odbył”. | Zawsze logować podsumowanie (dzień, liczniki, czas); tabela przebiegów (`job`, `day`, `finished_at`, `outcome`, liczniki); `/health` albo widok admina zgłasza nieaktualny job. |
| J3 | starty jobów (`subscription-lifecycle.scheduler.ts:19-23`, sprzątanie, przypomnienia w tle) | swallowed | high | Starty jobów są celowo niefatalne, a `/health` sprawdza tylko bazę: migracja psująca zapytanie joba przechodzi health-check, więc przywrócenie bazy się nie uruchamia. | Zapisać wynik przebiegu startowego i zgłaszać go w `/health` (degraded) albo mailem. |
| J4 ✓ | `trial-reminder.service.ts:110-114`, `trial-reminder.scheduler.ts:83` | flattened-response | high | Błędy per użytkownik są łapane i liczone; systemowa awaria rezerwacji (schemat, uprawnienia, timeout) kończy się „udanym” przebiegiem z `usersFailed = N`: jeden `warn` w `out.log`, bez maila. | Mail do operatora przy `usersFailed > 0` (z licznikami). |
| J5 | `trial-reminder.service.ts` (zwolnienie rezerwacji, komentarz `:64`) | swallowed | high | Gdy mail się nie udał, a zwolnienie znacznika też padnie, znacznik zostaje i przypomnienie ginie na zawsze, a log mówi „ponowione w następnym przebiegu”. Ten sam ślad zostawia pad procesu między rezerwacją a wysyłką. | Osobny błąd „rezerwacja niezwolniona, przypomnienia stracone” z id użytkownika; opcjonalnie kontrola: znacznik bez wiersza `mail`. |
| J6 ✓ | `mail.transport.ts:102-104`; `config/env.ts` (`NOTIFICATION_SMTP_HOST` opcjonalny w PROD) | config | high | Przy całkowitej awarii SMTP alarm o nieudanym przebiegu pada tak samo i zostaje tylko linia w logu — jedyna ścieżka alarmu znika wtedy, gdy jest potrzebna. | Patrz L3. |
| J7 ✓ | `trial-reminder.service.ts:113` | identity-lost | medium | „Trial reminder for one user failed: <msg>” bez UUID użytkownika (UUID to nie dane osobowe) i bez kroku (rezerwacja/zwolnienie). | Dodać `user <uuid>`, krok i kod błędu sterownika. |
| J8 ✓ | `subscription-lifecycle.scheduler.ts:53-55`, `auth-cleanup.scheduler.ts:43-47`, `trial-reminder.scheduler.ts:90-92` | missing-context | medium | Sam `error.message`: nie wiadomo, który z czterech kroków joba padł; kod PG i `routine` (bez parametrów) odrzucone. | Nazwany krok + `code` + stos (jak filtr). |
| J9 | `subscriptions/services/subscription-lifecycle.service.ts` | missing-context | medium | Kroki nie są jedną transakcją: kroki 1–2 zapisane, pętla przesuwania dat pada na wierszu N; liczniki i id wiersza nie trafiają do logu, a zły wiersz blokuje kolejne w każdym przebiegu. | Liczniki per krok na bieżąco; `catch` per wiersz z id subskrypcji. |
| J10 | `mail.service.ts:216-235` | noise | medium | Jedna blokada 15 min na proces dla wszystkich typów: awaria MAGIC_LINK może zużyć okno, alarm o TRIAL_REMINDER nie wyjdzie; alarm nie mówi, ile maili padło. | Blokada per typ, licznik pominiętych, znacznik po sukcesie. |
| J11 | `mail.service.ts:160` → `trial-reminder.service.ts` | flattened-response | medium | Błąd bazy przy sprawdzaniu konta = „brak konta”; w jobie liczony jako zwykła porażka. | Patrz L8 (wynik jako enum). |
| J12 | `mail.transport.ts` (wynik `sendMail` odrzucony) | coverage-gap | medium | Mail odbity po przyjęciu przez SMTP: wiersz SENT, znacznik zostaje, użytkownik nie dostaje przypomnienia; `messageId` nie jest zapisywany, więc odbicia nie da się dopasować. | Zapisać `messageId` w wierszu `mail`, monitorowana skrzynka zwrotna. |
| J13 | `logger.warn` w schedulerach i `mail.service.ts` | logged-not-captured | low | Częściowe porażki i „poprzedni przebieg trwa” lądują w `out.log`, a `deploy.sh` każe czytać `err.log`. | Częściowe porażki jako `error` albo jeden plik logu. |
| J14 | `mail.service.ts:132` | noise | low | Trwale odrzucony adres jest ponawiany codziennie aż do wyjścia z okna 7 dni. | Po odrzuceniu adresata zostawić znacznik i zalogować raz z id użytkownika. |
| J15 | `trial-reminder.service.ts` + `mail.service.ts:77-82` | noise | low | `usersFailed` liczy konta zablokowane/usunięte w trakcie jako „porażki ponawiane” — zawyża jedyną liczbę częściowej awarii. | Liczyć „pominięte” osobno. |

### Usuwanie konta i panel admina

| # | Location | Category | Severity | What happens in production | Fix direction |
|---|---|---|---|---|---|
| A1 ✓ | `backend-subtracker/src/admin/services/admin-users.service.ts:185`; `shared/guards/roles.guard.ts:29`; filtr `:40-43` | coverage-gap | high | Odmowy rangi (admin próbuje zablokować admina/superadmina) i próby zwykłego użytkownika na `/admin/*` nie zostawiają ani wiersza `admin_audit` (transakcja wycofana), ani linii logu. | Wiersz `DENIED` w osobnej instrukcji poza wycofywaną transakcją albo `warn` z id. |
| A2 | `config/http-security.ts:14`; `admin/admin-action-dialog/admin-action-dialog.ts:62-66`; `pages/account/delete-account-dialog/delete-account-dialog.ts:175` | flattened-response | high | Zła lista `CORS_ORIGINS` albo zmiana domeny frontu: każde usunięcie konta i każda blokada kończy się 403 CSRF, pokazanym jako „Brak uprawnień” albo „Serwis chwilowo niedostępny”; nic w logach. | `warn` przy odmowie CSRF (powód + Origin, bez PII); front odróżnia 403 rangi (`Cannot manage this account`) od innych. |
| A3 ✓ | `auth/services/account-deletion.service.ts:18-44` | coverage-gap | medium | Udane usunięcie konta nie zostawia logu ani rekordu; przy „moje konto zniknęło” lub pytaniu RODO nie da się wykazać, czy i kiedy użytkownik je usunął; wiersze `admin_audit` z tym id tracą znaczenie. | Linia `Account <uuid> deleted` albo minimalny wiersz `account_deletion(user_id, deleted_at)`. |
| A4 | filtr `:56-61`; blokada wiersza użytkownika (`account-access.service.ts`, `account-deletion.service.ts`) | missing-context | medium | Timeout 5 s na blokadzie wiersza to `canceling statement due to statement timeout (code: 57014)` — nie wiadomo, czy padła blokada, odblokowanie, usunięcie czy link, ani dla kogo. | Patrz P2. |
| A5 | `mail.service.ts:160` → `:77-82` | swallowed | medium | Błąd bazy przy sprawdzaniu adresata pomija mail o blokadzie, choć dialog obiecał „Dostanie o tym wiadomość e-mail”. | Patrz L8. |
| A6 | `cli/role-script.ts:17-18, 56`; `users/role-grants.ts:67` | missing-throw | medium | Skrypt ról pisze „granted/revoked” także, gdy rola już była/nie była (`ON CONFLICT DO NOTHING`); rola nieaktywna jest „nadana” bez efektu; brak wiersza audytu dla nadania ADMIN/SUPER_ADMIN. | Zgłaszać „już nadana / nie była nadana”, odmawiać nieaktywnych ról, wiersz audytu z aktorem `cli`. |
| A7 | `admin/controllers/admin-users.controller.ts`, `admin-users.service.ts` (wyszukiwanie) | coverage-gap | medium | Wyszukiwanie (do 20 adresów ze statusem, np. `status=blocked` bez `q`) nie zostawia wiersza `admin_audit`, choć ujawnia dane osobowe. | Wiersz SEARCH z aktorem, filtrem i liczbą wyników (bez `q`, jeśli to PII). |
| A8 | `account-access.service.ts` (mail po commicie) | missing-context | low | Wyniku maila o blokadzie nie da się powiązać z akcją admina (wiersz `mail` ma adres, audyt tylko id); po usunięciu konta niemożliwe. | `target_id` w wierszu `mail` albo id audytu w logu. |
| A9 | `pages/admin/admin-users/admin-users.ts:116-117`; dialogi `delete-account-dialog.ts:164-176`, `admin-action-dialog.ts:127-136` | flattened-response | low | Każde 400 wyszukiwania = „za krótkie”; błędy dialogów bez `console.error`. | Mapowanie po komunikacie; `console.error` statusu i URL. |
| A10 | `cli/role-script.ts:59-71` | identity-lost | low | CLI wypisuje sam `error.message` — kody PG (28P01, 57014) giną. | Wypisywać `code`, stos pod `--verbose`. |

### Platforma / kod przekrojowy

| # | Location | Category | Severity | What happens in production | Fix direction |
|---|---|---|---|---|---|
| P1 ✓ | `backend-subtracker/src/main.ts` (brak `process.on`); `deploy/mydevil/start-app.sh:31-43`; `health.controller.ts:25` sprawdzany tylko w `deploy.sh` | coverage-gap | critical | Pad procesu i pętla restartów (np. baza nieosiągalna przy starcie: ~20 s na cykl, więc `forever` nie uznaje tego za „spinning”) są ciche: użytkownicy dostają 502, operator nic. Precedens: pętla już raz zablokowała deploy (`stop-app.sh:4-5`). | Handlery `uncaughtException`/`unhandledRejection` logujące bezpiecznym formatem i kończące proces kodem 1; skrypt watchdog w `deploy/mydevil/` (cron: `curl /health` → mail do operatora po N porażkach). |
| P2 ✓ | `shared/filters/safe-logging-exception.filter.ts:56-61` | missing-context | high | Każda linia 500 nie ma metody, szablonu trasy, użytkownika ani identyfikatora żądania; zgłoszenie „o 10:03 nie działało” pasuje do kilku stosów. | Logować metodę, szablon trasy (`request.route?.path`, bez query), id użytkownika i wygenerowany request id; request id w nagłówku odpowiedzi. |
| P3 | `main.ts:12-28`, `frontend-subtracker/src/server.ts` | coverage-gap | high | Żaden proces nie ma access logu: nie widać liczby żądań, statusów ani czasów — ani skoku 4xx, ani spowolnienia. | Jedna linia na żądanie (metoda, szablon trasy, status, czas), bez query. |
| P4 ✓ | `main.ts:13, 23-27`; `trial-reminder.scheduler.ts:79-80`; `@nestjs/common/utils/cli-colors.util.js` | config | medium | Kody ANSI w plikach logów, lokalny znacznik czasu bez strefy (niejednoznaczny przy zmianie czasu w oknie joba 02:00), stos w osobnych liniach bez prefiksu, `warn` w `out.log`. | `new ConsoleLogger({ json: true })` albo `colors: false` + `NO_COLOR=1`, znacznik ISO UTC, usunąć ręczne kolory. |
| P5 | `config/http-security.ts:14`; `shared/decorators/current-user.decorator.ts:12-14` | flattened-response | medium | Odmowa CSRF (błąd konfiguracji) i `CurrentUser` bez użytkownika (błąd programisty) to nielogowane 403/401; to drugie front zamienia w ciche wylogowanie. | `warn` przy CSRF (Origin, ścieżka, z limitem); `CurrentUser` bez użytkownika jako 500. |
| P6 | `deploy.sh` (`.deploy-info`) vs `main.ts`, `/health` | identity-lost | medium | Nie wiadomo, które wydanie wygenerowało błąd ani czy rollback zadziałał. | Czytać `.deploy-info` przy starcie: SHA w linii startowej i w `/health`. |
| P7 ✓ | `frontend-subtracker/src/server.ts:64`; `@angular/ssr` (`hasNavigationError` → `null`) | flattened-response | medium | Błąd guarda/resolvera w SSR kończy się 404 „Cannot GET”, a konsola ma linię bez URL; błąd renderu → stos bez URL. | Middleware błędów w `server.ts` (metoda, ścieżka, stos → 500); `null` na znanej trasie traktować jako błąd. |
| P8 | `app.config.ts:17`; `app.routes.ts` (12 tras lazy), brak `withNavigationErrorHandler` | coverage-gap | medium | Po każdym deployu stare karty mają martwe linki (brak starych chunków), błędy przeglądarki nie docierają do operatora. | Przeładowanie raz przy błędzie ładowania chunka; opcjonalnie `POST /client-errors` z limitem, bez PII. |
| P9 | `health.controller.ts:25`; `deploy.sh` | missing-throw | medium | Deploy z brakującą migracją przechodzi health-check; awaria wychodzi później jako 500 `relation ... does not exist`. | `/health` sprawdza, że ostatnia zastosowana migracja = najnowsza w paczce. |
| P10 | `database/database.options.ts` (brak `logging`) | swallowed | low | Błędy puli pg (zerwane połączenia) i wolne zapytania są niewidoczne. | `logging: ['error','warn']` z własnym loggerem bez parametrów albo `poolErrorHandler`; `maxQueryExecutionTime`. |
| P11 | domyślny printer Node przy nieobsłużonym błędzie | logged-not-captured | low | Nieobsłużony `QueryFailedError` wypisałby `parameters` (adresy e-mail) do `err.log`, omijając bezpieczny filtr. | Załatwia P1 (handlery z `describeError`). |
| P12 ✓ | `safe-logging-exception.filter.ts:40-43` | logged-not-captured | low | Dziś nikt nie rzuca 5xx `HttpException`, ale pierwszy `ServiceUnavailableException` da 5xx bez logu. | Przed wczesnym `return` sprawdzić `getStatus() >= 500`. |
| P13 | `users/role-grants.ts`, `config/cors.ts`, ogółem 33× `new Error(` bez `cause` | identity-lost | low | Oryginalny błąd sterownika lub URL ginie przy ponownym rzuceniu. | `new Error(msg, { cause: error })`. |

## 6. Recommended fix order

1. **Sygnał życia: watchdog + rejestr przebiegów jobów** (P1, J1, J2, J3, J4; częściowo S9, P9). Skrypt `deploy/mydevil/watchdog.sh` z crontaba (jak `prune-backups.sh`): `curl /health` co kilka minut, mail do operatora po N porażkach — działa także, gdy API leży. W API: wspólny helper „job finished/failed” → tabela przebiegów + mail do operatora przy każdej awarii joba i przy `usersFailed > 0`; `/health` zgłasza job nieaktualny > 26 h. Handlery procesu z bezpiecznym formatem. Odpowiada wprost na pytanie roadmapy #3. Ograniczenie: mail bez danych użytkowników (tylko dzień, job, liczniki); idempotentność jobów bez zmian (`lessons.md`).
2. **Kontekst żądania w filtrze + odmowy 4xx z kodem przyczyny** (P2, P12, L1, L7, A1, A2, P5, S1, S4; częściowo S3, A4). Jeden plik: metoda, szablon trasy, id użytkownika, request id dla 5xx; dla wybranych 4xx (401 weryfikacji i sesji, 403 CSRF i rangi, 400 walidacji) linia `warn` z kodem przyczyny i nazwami pól, **bez wartości, adresów, tokenów i query**, z limitem, żeby obcy nie mogli rozdmuchać logu (pierwotny powód decyzji).
3. **Kanał alarmowy, który nie pada razem z SMTP** (L3, J6, J10, L2). Wymagany `NOTIFICATION_SMTP_*` w PROD (walidacja w `env.ts`), znacznik blokady po przyjęciu alarmu, blokada per typ z licznikiem pominiętych, klasyfikacja odrzuceń po statusie rozszerzonym.
4. **Format logu i wersja** (P4, P6, P3). `ConsoleLogger({ json: true })` albo bez kolorów, znacznik ISO, SHA z `.deploy-info` w linii startowej i `/health`, prosty access log w obu procesach.
5. **Raporty z przeglądarki i SSR** (L4, L5, L6, S5–S7, A9, P7, P8). Wspólny helper błędów HTTP we froncie, `console.error` po stronie SSR w guardach, middleware błędów w `server.ts`, przeładowanie przy błędzie chunka; endpoint `POST /client-errors` dopiero po decyzji o limicie i prywatności.
6. **Rozróżnienie przyczyn w mailach i jobach** (L8, J5, J7, J8, J9, J11, A5, J15). Wynik `sendToUser` jako enum, UUID użytkownika i krok w logach jobów, `catch` per wiersz w cyklu życia.
7. **Ślady audytowe** (A3, A6, A7, A8). Log/wiersz usunięcia konta, wiersze DENIED i SEARCH, uczciwe komunikaty CLI.
8. Reszta lokalnych poprawek (S2, S6, S10, S11, S13, J12–J14, L9–L11, P10, P13).

## 7. Changes since last audit

Pierwszy audyt — brak wcześniejszego raportu.

## 8. Method and limits

- **Agenci:** pięciu audytorów tylko do odczytu, równolegle — po jednym na obszar (logowanie, subskrypcje i budżet, joby i maile, konto i admin) i jeden przekrojowy (granice, logger, bootstrap, SSR, klient, przegląd repo). Wersje zależności sprawdzone w `node_modules`: `@nestjs/*` 12.1.2, Express 5.2.1, `@angular/ssr` 22.2.0.
- **Sprawdzone ręcznie** (✓ w tabelach): wczesny `return` dla `HttpException` i próg 500 w filtrze; gołe 401 w weryfikacji linku i `expiresAt` z zegara Node vs `now()` bazy; transport operatora = transport użytkowników bez `NOTIFICATION_SMTP_*`; znacznik blokady alarmu ustawiany przed wysyłką; `/health` = `SELECT 1`; job cyklu życia bez maila do operatora i logowanie tylko przy zmianach; `null` z `@angular/ssr` przy błędzie nawigacji → `next()` w `server.ts`; kolory Nest zależne tylko od `NO_COLOR`; `catchError` w guardach. Wszystkie się potwierdziły. Część numerów linii podanych przez audytorów była przesunięta — w tabelach poprawione tam, gdzie sprawdzone; pozostałe linie pochodzą z raportów audytorów.
- **Korekta modelu w trakcie:** audytor konta wykazał drugi aktywny alarm (mail do operatora przy nieudanej wysyłce maila do użytkownika) — uwzględniony w §2.
- **Przegląd repo** (bez testów): puste `catch` 0; `catch` bez wiązania 1 (`config/cors.ts`, ponownie rzuca z kontekstem); `catchError(() =>` z wartością domyślną 3 (`auth.guard.ts:50`, `:80`, `subscription-form.ts:225`); `console.*` w kodzie uruchomieniowym 5; `logger.error`/`warn` 19; `new Error(` bez `cause` 33, `cause` nieużywane nigdzie.
- **Dowód uruchomieniowy:** nie uruchomiony (`runtime_proof: not-run`). Bez trackera sonda pokazałaby tylko odpowiedź i logi; kandydaci do potwierdzenia: pętla restartów przy niedostępnej bazie (P1), 404 przy błędzie nawigacji SSR (P7), cisza joba przy 0 wierszach (J2), odmowa CSRF bez logu (A2). Wszystkie ustalenia są statyczne.
- **Poza zakresem, zauważone przy okazji:** audytor przekrojowy wskazał produkcyjną domenę w `frontend-subtracker/angular.json` i `src/environments/environment.ts` (konfiguracja buildu) — do oceny względem zasady „bez prawdziwej domeny w repo”.
