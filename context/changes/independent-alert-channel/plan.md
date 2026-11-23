# Niezależny kanał alarmów operatora — plan implementacji

## Overview

Alarm do operatora ma dochodzić także wtedy, gdy nie działa wysyłka maili do użytkowników. Na produkcji API startuje tylko z osobnym kontem SMTP dla alarmów (`NOTIFICATION_SMTP_*`, inny login niż `SMTP_USERNAME`). Blokada powtórzeń alarmu liczy się osobno dla każdego typu maila i dopiero od alarmu przyjętego przez serwer. Nieudany alarm nie wycisza więc kolejnych. Za literówkę w adresie (tylko `warn`, bez alarmu) uznajemy wyłącznie rozszerzony status 5.1.x. Relay, limit wysyłki, SPF/DMARC i każde inne odrzucenie dają alarm. Skrypt `operator:test-mail` pozwala sprawdzić kanał na serwerze bez psucia czegokolwiek.

Plan realizuje PRD v2 FR-020 i roadmapę S-12. Zamyka L2, L3, J6 i J10 z audytu `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (§6 pkt 3).

## Current State Analysis

- **Transport operatora.**
  - `createMailTransport` (`backend-subtracker/src/mail/mail.transport.ts:95-112`) wysyła kanał `operator` przez `NOTIFICATION_SMTP_*`, a gdy ich brak, przez transport użytkowników (`sendToUser`).
  - `validateEnv` (`src/config/env.ts:170-173`) przyjmuje pusty `NOTIFICATION_SMTP_HOST` w każdym trybie. Ustawiony host wymaga loginu, hasła i nadawcy (`readNotificationField`).
  - W PROD wymagane są dziś tylko `SMTP_HOST` (z kompletem pól) i `NOTIFICATION_ADMINISTRATOR_MAIL`.
- **Kto wysyła alarmy.**
  - `MailService.notifyOperator` (`src/mail/services/mail.service.ts:88-102`): przebiegi jobów (`src/jobs/job-run.service.ts:95`) i alarm o nieudanej wysyłce (`:212-235`).
  - Watchdog (`src/cli/watchdog.ts:92-106`) idzie przez `createMailTransport` z kanałem `operator`, bez `MailService` i bez bazy.
  - Wymuszenie osobnego kanału obejmie więc wszystkie trzy drogi.
- **Blokada alarmu o nieudanej wysyłce** (`mail.service.ts:212-235`):
  - jedno pole `lastOperatorAlertAt` na proces, wspólne dla wszystkich typów (J10);
  - ustawiane przed wysyłką, więc nieudany alarm wycisza kolejne na 15 min (L3);
  - `notifyOperator` zwraca `void`, a `deliver` zna wynik (`sent`);
  - alarm nie mówi, ile maili padło.
- **Odrzucenie adresata.** `isRecipientRejected` (`:41-49`) uznaje każde `EENVELOPE` + `RCPT TO` + `responseCode >= 500` za literówkę, bez alarmu (L2). Nodemailer (`node_modules/nodemailer/dist/cjs/smtp-connection/index.js`, `_formatError`) ustawia na błędzie `response` z pełną linią odpowiedzi, np. `550 5.1.1 <adres>: Recipient address rejected`. Rozszerzony status da się z niej odczytać, ale linia może zawierać adres.
- **Log porażki** (`logFailure`, `:171-183`): `warn` dla literówki, `error` dla reszty, z `code` i id wiersza audytu, bez adresu.
- **Testy.**
  - `src/config/env.spec.ts` (m.in. `:219-230`, pola SMTP);
  - `src/mail/mail.transport.spec.ts`;
  - `src/mail/services/mail.service.spec.ts`: blokada na sztucznym zegarze `:214-236`, odrzucenia `:158-212`, brak pętli `:238-252`.
- **CLI.** Wzór skryptów: `package.json` (`"admin:grant": "nest build && node dist/cli/admin-grant.js"`). Watchdog ma cienkie `src/cli/watchdog.ts` i logikę w `src/watchdog/` z testami. Na serwerze `watchdog.sh` uruchamia `cli/watchdog.js` z katalogu wydania po wczytaniu `./.env` (`deploy/mydevil/watchdog.sh:98-109`).
- **Dokumentacja do zmiany:**
  - `deploy/mydevil/README.md:65` i `:326`: „zostaw `NOTIFICATION_SMTP_*` puste”;
  - `:207`, `:239`, `:468`, `:500`: „do S-12 alarmy idą tym samym SMTP”;
  - `context/foundation/backend-patterns.md`, sekcja „Maile”: puste `NOTIFICATION_SMTP_*` oznaczają transport `SMTP_*`;
  - `backend-subtracker/.env.example:64-74`.

## Desired End State

- **Start w PROD:**
  - brak któregokolwiek z `NOTIFICATION_SMTP_HOST`, `_USERNAME`, `_PASSWORD`, `_FROM_EMAIL` zatrzymuje start komunikatem z nazwą klucza;
  - `NOTIFICATION_SMTP_USERNAME` równy `SMTP_USERNAME` (bez wielkości liter i białych znaków na brzegach) zatrzymuje start komunikatem, że kanał alarmów musi mieć osobne konto;
  - ten sam host jest dozwolony.
- **DEV** działa jak dziś: puste `NOTIFICATION_SMTP_*` kierują alarmy transportem użytkowników albo na konsolę.
- **`npm run operator:test-mail`:**
  - wysyła jeden mail transportem operatora na `NOTIFICATION_ADMINISTRATOR_MAIL`;
  - kończy się kodem 0, gdy serwer przyjął mail, a kodem 1 przy błędzie env, braku adresu albo odrzuceniu;
  - w logu ma tylko wynik i kod błędu SMTP, bez hasła i adresu.
  
  Na serwerze: `cd ~/apps/subtracker/api/live && node cli/operator-test-mail.js`.
- **Odrzucenie adresata:**
  - literówką jest tylko `EENVELOPE` + `RCPT TO` z rozszerzonym statusem `5.1.x` w odpowiedzi; zostaje `warn` bez alarmu, jak dziś;
  - każde inne odrzucenie (5.7.x, 5.2.x, 5.5.x, 4xx, 5xx bez rozszerzonego statusu) to `error` i alarm;
  - log podaje `code` i rozszerzony status (np. `status: 5.7.1`), nigdy pełnej odpowiedzi serwera.
- **Alarm o nieudanej wysyłce, osobno dla każdego typu maila:**
  - Po alarmie przyjętym przez serwer następny alarm tego typu może wyjść najwcześniej po 15 min (`OPERATOR_ALERT_INTERVAL_MS`).
  - Po nieudanym alarmie kolejna próba najwcześniej po 1 min (`OPERATOR_ALERT_RETRY_MS`).
  - Porażki tego typu w czasie blokady są liczone. Alarm podaje „pominięte od poprzedniego alarmu: N”, a po przyjętym alarmie licznik się zeruje.
  - Porażka, której alarm się nie udał, liczy się do licznika następnego alarmu.
- **`notifyOperator`** zwraca `Promise<boolean>`: czy serwer przyjął alarm. Nadal nie rzuca.
- **Dokumenty** opisują wymagany kanał, skrypt testowy i nowe reguły alarmu.

### Key Discoveries:

- Wymuszenie w `validateEnv` obejmuje też watchdoga: `cli/watchdog.ts` woła `validateEnv` i `createMailTransport` (`src/cli/watchdog.ts:92-117`). Zła konfiguracja kończy jego przebieg wpisem `cannot run` w `watchdog.log`, a nie cichym alarmem przez złe konto.
- Nowy wymagany klucz w PROD oznacza, że deploy bez kluczy w `shared/.env` nie przejdzie health-checku i zostanie wycofany (`deploy/mydevil/README.md`, sekcja o deployu API). Klucze muszą trafić na serwer przed merge'em.
- `response` nodemailera może zawierać adres odbiorcy. Do logu idzie tylko wyciągnięty status, a pełny tekst zostaje w wierszu audytu, jak dziś (`MAIL_ERROR_MESSAGE_MAX_LENGTH`).

## What We're NOT Doing

- Drugi dostawca poczty spoza MyDevil. Awaria całej poczty MyDevil wyłącza też alarmy, a ślad zostaje w `watchdog.log` (przyjęte w roadmapie 2026-11-22).
- Przyczyny porażek jobów i maili (brak konta, konto zablokowane, błąd bazy) i ślad audytowy. To S-16.
- Trwały stan blokady i licznika (baza, plik): restart procesu je zeruje.
- Blokada albo licznik dla alarmów jobów i watchdoga. Mają własne reguły (S-11): job alarmuje raz na przebieg, watchdog ma progi i okno 12 h.
- Alarm przy serii literówek (próg N odrzuceń 5.1.x w oknie).
- Zmiana treści alarmów jobów i watchdoga.
- Sprawdzanie przy starcie, że login i hasło SMTP są poprawne (połączenie z serwerem). Służy do tego skrypt testowy.

## Implementation Approach

Faza 1 daje działający, wymagany kanał i narzędzie do jego sprawdzenia, jeszcze bez zmiany logiki alarmów. Faza 2 zmienia tylko `MailService`, czyli klasyfikację odrzuceń i stan alarmu per typ. Faza 3 to dokumenty i wdrożenie, z kluczami na serwerze przed merge'em.

Odczyt rozszerzonego statusu SMTP to kod ogólny, bez wiedzy o domenie. Trafia do `src/mail/smtp-error.ts` obok transportu, bo dotyczy tylko poczty (moduł `mail/` jest jedynym użytkownikiem SMTP). Logika skryptu testowego trafia do `src/mail/operator-test-mail.ts` z testem, a `src/cli/operator-test-mail.ts` tylko ją wywołuje, jak `watchdog.ts`.

## Critical Implementation Details

- **Kolejność stanu alarmu.** Przed wysyłką alarmu dany typ dostaje rezerwację na `OPERATOR_ALERT_RETRY_MS`. Porażki, które przyjdą w trakcie wysyłki (równoległe żądania logowania), liczą się wtedy jako pominięte, a nie wysyłają drugiego alarmu. Po przyjęciu alarmu okno wydłuża się do `OPERATOR_ALERT_INTERVAL_MS` od chwili przyjęcia, a licznik zeruje się o liczbę zgłoszoną w tym alarmie. Po nieudanym alarmie rezerwacja zostaje jako okno ponowienia, a zgłaszana liczba wraca do licznika razem z bieżącą porażką.

## Phase 1: Osobny kanał alarmów w PROD

### Overview

Produkcja startuje tylko z osobnym kontem SMTP dla alarmów, a skrypt `operator:test-mail` sprawdza, czy alarm przez to konto wychodzi.

### Changes Required:

#### 1. Walidacja env

**File**: `backend-subtracker/src/config/env.ts`, `backend-subtracker/src/config/env.spec.ts`

**Intent**: W PROD kanał alarmów jest wymagany i nie może być tym samym kontem co poczta do użytkowników. DEV zostaje bez zmian.

**Contract**:
- przy `MODE=PROD` `NOTIFICATION_SMTP_HOST` przez `requireString`, więc reszta pól jest wymagana jak dziś przez `readNotificationField`;
- po odczycie w PROD: `NOTIFICATION_SMTP_USERNAME.trim().toLowerCase() === SMTP_USERNAME.trim().toLowerCase()` → `Error('NOTIFICATION_SMTP_USERNAME must name a separate mailbox from SMTP_USERNAME in PROD')`;
- `EnvConfig` bez zmian typów, a komentarz przy `notificationHost` mówi, że puste znaczy transport `SMTP_*` tylko w DEV;
- testy: PROD bez hosta (komunikat z kluczem), PROD z hostem bez hasła, PROD z tym samym loginem (także inne wielkości liter), PROD poprawny, DEV z pustym hostem jak dziś;
- fikstury PROD, które przechodzą przez `validateEnv`, dostają komplet `NOTIFICATION_SMTP_*` z osobnym loginem: wspólne `prodEnv` w `src/config/env.spec.ts:14` i `prodEnv` w `src/database/database.options.spec.ts:15`.

#### 2. `.env.example`

**File**: `backend-subtracker/.env.example`

**Intent**: Szablon mówi, że w PROD kanał alarmów jest wymagany i musi być osobną skrzynką.

**Contract**: komentarz nad `NOTIFICATION_SMTP_*` (`:64-65`) i lista wymaganych kluczy PROD (`:13`) uzupełnione o `NOTIFICATION_SMTP_HOST`, `_USERNAME`, `_PASSWORD`, `_FROM_EMAIL`. Bez wartości.

#### 3. Skrypt testowy kanału alarmów

**File**: `backend-subtracker/src/mail/operator-test-mail.ts` (+ `operator-test-mail.spec.ts`), `backend-subtracker/src/cli/operator-test-mail.ts`, `backend-subtracker/package.json`

**Intent**: Operator sprawdza na serwerze i lokalnie, że alarm wychodzi osobnym kontem, bez psucia API czy crona.

**Contract**:
- `sendOperatorTestMail(env: EnvConfig, transport: MailTransport, log: (line: string) => void): Promise<boolean>`:
  - bez `NOTIFICATION_ADMINISTRATOR_MAIL` → `false` i linia `NOTIFICATION_ADMINISTRATOR_MAIL is not set`;
  - inaczej jeden `transport.send({ channel: 'operator', to, subject: 'SubTracker: test kanału alarmów', text, html })`, z treścią podającą czas wysłania, bez hasła i hosta;
  - wynik `true` albo `false` z linią `test mail failed (code: <code|unknown>)`, bez pełnego komunikatu błędu, bo może zawierać adres;
  - przed wysyłką linia mówiąca, który kanał sprawdza: `operator channel: separate (<NOTIFICATION_SMTP_FROM_EMAIL>)`, a w DEV bez `NOTIFICATION_SMTP_HOST` `operator channel: shared with SMTP_* (DEV)` albo `console (DEV)`, gdy nie ma też `SMTP_HOST`; bez hasła, loginu i hosta.
- `src/cli/operator-test-mail.ts`:
  - wzór z `src/cli/watchdog.ts` (`setup`: `process.loadEnvFile('.env')`, gdy plik istnieje, i `validateEnv`), błąd env → linia `cannot run: …` i kod 1;
  - `process.exitCode = ok ? 0 : 1`;
  - linie z prefiksem `[operator-test-mail <ISO>]`.
- `package.json`: `"operator:test-mail": "nest build && node dist/cli/operator-test-mail.js"`.
- Testy: brak adresu, przyjęty mail (kanał `operator`, adres operatora), odrzucenie (wynik `false`, w logu kod bez adresu), linia kanału dla `separate`, `shared` i `console`.

### Success Criteria:

#### Automated Verification:

- Testy env i skryptu przechodzą: `npx vitest run src/config src/mail/operator-test-mail.spec.ts`
- Celowe uszkodzenie: usunięcie porównania loginów albo powrót do `readString` dla hosta w PROD czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu (env DEV bez zmian): `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie `npm run operator:test-mail` (w `.env` lokalne dane nowej skrzynki) kończy się kodem 0, a mail testowy przychodzi na adres operatora od nowej skrzynki

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: Alarm o nieudanej wysyłce

### Overview

Za literówkę uchodzi tylko status 5.1.x. Alarm o nieudanej wysyłce ma osobne okno dla każdego typu maila, liczone od przyjętego alarmu, ponowienie po 1 min i licznik pominiętych.

### Changes Required:

#### 1. Rozszerzony status SMTP

**File**: `backend-subtracker/src/mail/smtp-error.ts` (+ `smtp-error.spec.ts`), `backend-subtracker/src/mail/services/mail.service.ts`

**Intent**: Odróżnić złą skrzynkę odbiorcy od odrzucenia, które jest awarią po naszej stronie albo serwera.

**Contract**:
- `enhancedStatusOf(error: unknown): string | undefined`: z `response` (string) odczytuje rozszerzony status z początku linii odpowiedzi według RFC 3463 (`/^\d{3}[ -]([245]\.\d{1,3}\.\d{1,3})\b/`), inaczej `undefined`;
- `isRecipientTypo(error)`: `code === 'EENVELOPE'`, `command === 'RCPT TO'`, `responseCode >= 500` i status zaczyna się od `5.1.`;
- `isRecipientRejected` w `mail.service.ts` zastąpione przez `isRecipientTypo`;
- `logFailure` dopisuje `status: <x>`, gdy jest: literówka to `warn` `Recipient of <TYPE> mail rejected (code: EENVELOPE, status: 5.1.1, audit row: …)`, reszta `error` `Sending <TYPE> mail failed (code: …, status: 5.7.1, audit row: …)`. Pełna odpowiedź nigdy nie trafia do logu;
- testy `smtp-error.spec.ts`:
  - `550 5.1.1`, `550-5.1.10`, `550 5.7.1`, `550 bez statusu`, `452 4.5.3`;
  - `response` nie będący stringiem;
  - `MAIL FROM` z 5.1.x (odrzucony nadawca to nie literówka).

#### 2. Stan alarmu per typ

**File**: `backend-subtracker/src/mail/services/mail.service.ts`, `backend-subtracker/src/mail/services/mail.service.spec.ts`

**Intent**: Nieudany alarm nie wycisza kolejnych, awaria jednego typu nie zasłania drugiego, a operator widzi skalę.

**Contract**:
- stałe `OPERATOR_ALERT_INTERVAL_MS = 15 * 60 * 1000` (bez zmian) i nowa `OPERATOR_ALERT_RETRY_MS = 60 * 1000`;
- `lastOperatorAlertAt` zastąpione przez `Map<MailType, { blockedUntil: number; skipped: number }>`; kolejność zmian stanu w „Critical Implementation Details”;
- `notifyOperator(content): Promise<boolean>`:
  - zwraca `sent` z `deliver`;
  - bez adresu operatora → `false`;
  - `JobRunService` ignoruje wynik, bez zmian w jego kodzie;
- treść alarmu (`subject` bez zmian):
  - `text` i `html` dostają linię `pominięte od poprzedniego alarmu: N` (także `0`);
  - nadal bez treści maila i bez adresu, z escapowaniem w HTML.
- testy (sztuczny zegar, wzór `:214-236`):
  - 5.1.1 bez alarmu, a 5.7.1 i 550 bez statusu z alarmem;
  - dwa typy w jednym oknie → dwa alarmy;
  - nieudany alarm → kolejna porażka po 59 s bez próby, po 60 s z próbą;
  - po przyjętym alarmie 15 min ciszy dla tego typu;
  - liczba pominiętych w następnym alarmie i zerowanie po przyjętym;
  - porażka z nieudanym alarmem wliczona do następnego;
  - dwie równoległe porażki dają jeden alarm i `pominięte: 1` w następnym;
  - `notifyOperator` zwraca `true` albo `false`;
  - istniejący test braku pętli (`:238-252`) przechodzi.

### Success Criteria:

#### Automated Verification:

- Testy poczty przechodzą: `npx vitest run src/mail`
- Celowe uszkodzenie: ustawienie okna 15 min przed wysyłką alarmu albo uznanie każdego 5xx za literówkę czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie z błędnym `SMTP_PASSWORD` w `.env` (i poprawną skrzynką alarmów) prośba o link logowania dla adresu istniejącego, aktywnego konta (np. `DEV_USER_EMAIL`) daje 202, a na adres operatora przychodzi jeden alarm z `typ: MAGIC_LINK` i `pominięte od poprzedniego alarmu: 0`; druga prośba w ciągu 15 min nie wysyła alarmu, a w logu jest linia `Sending MAGIC_LINK mail failed`

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 3. Przywróć poprawne `SMTP_PASSWORD` po teście.

---

## Phase 3: Dokumentacja i produkcja

### Overview

Dokumenty opisują wymagany kanał i nowe reguły alarmu, a nowa skrzynka działa na produkcji.

### Changes Required:

#### 1. Dokumenty

**File**: `deploy/mydevil/README.md` (część polska i angielska), `context/foundation/backend-patterns.md`, `CLAUDE.md`

**Intent**: Operator wie, że kanał alarmów jest wymagany w PROD i jak go sprawdzić, a kolejny slice zna reguły alarmu.

**Contract**:
- README:
  - `:65` i `:326`: `NOTIFICATION_SMTP_*` wymagane w PROD, osobna skrzynka (inny login niż `SMTP_USERNAME`); bez nich nie przejdzie `migration:run` ani start API (deploy się wycofa), nie zadziałają skrypty ról i watchdog;
  - `:207` i `:468`: transport operatora bez fallbacku w PROD;
  - `:239` i `:500`: zdanie „Do S-12…” zastąpione opisem ograniczenia (awaria całej poczty MyDevil);
  - nowy akapit o `node cli/operator-test-mail.js` z `api/live`, z kodem wyjścia, po zmianie hasła i po deployu.
- `backend-patterns.md`, „Maile”:
  - puste `NOTIFICATION_SMTP_*` tylko w DEV;
  - reguła alarmu o nieudanej wysyłce: per typ, 15 min od przyjęcia, 1 min po porażce, licznik pominiętych;
  - literówka to tylko 5.1.x, a status w logu bez pełnej odpowiedzi.
- `CLAUDE.md`, Architecture (backend): zdanie o wymaganym osobnym kanale alarmów w PROD i `operator:test-mail`, poza blokiem synchronizowanym przez 10x.

### Success Criteria:

#### Automated Verification:

- CI zielone na PR (`backend`, `backend-e2e`, `frontend`, `browser-e2e`, `deploy-scripts`)

#### Manual Verification:

- Przed merge'em: `NOTIFICATION_SMTP_HOST`, `_PORT`, `_SECURE`, `_USERNAME`, `_PASSWORD`, `_FROM_EMAIL` dopisane do `~/apps/subtracker/api/shared/.env` na serwerze
- Po deployu API: `curl localhost:<PORT_API>/health` zwraca 200, a na serwerze `cd ~/apps/subtracker/api/live && node cli/operator-test-mail.js; echo "exit $?"` daje `exit 0` i mail od nowej skrzynki
- Następny przebieg watchdoga nie wpisuje `cannot run` do `watchdog.log`

**Implementation Note**: Po wdrożeniu i ręcznych testach na produkcji zatrzymaj się na potwierdzenie przed `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `validateEnv`: PROD bez kanału, z niekompletnym kanałem, z tym samym loginem (różne wielkości liter), poprawny; DEV z pustym kanałem.
- `sendOperatorTestMail`: brak adresu, przyjęty mail, odrzucenie bez adresu w logu.
- `enhancedStatusOf` i `isRecipientTypo`: 5.1.1, 5.1.10, 5.7.1, gołe 550, 4.x, `MAIL FROM`, brak `response`.
- `MailService`: klasyfikacja i alarm, okna per typ, ponowienie po 1 min, licznik pominiętych, równoległe porażki, wynik `notifyOperator`, brak pętli.

### Integration Tests:

- `npm run test:e2e` bez zmian w testach: e2e i CI działają w DEV, więc wymuszenie PROD ich nie dotyka, a `job-run.e2e-spec.ts` dalej przechodzi z `notifyOperator` zwracającym wynik.

### Manual Testing Steps:

1. Lokalnie `npm run operator:test-mail`: mail od nowej skrzynki.
2. Lokalnie błędne `SMTP_PASSWORD`: jeden alarm `MAGIC_LINK`, druga prośba bez alarmu.
3. Produkcja: klucze w `shared/.env` przed merge'em, po deployu `/health` 200 i skrypt testowy z `exit 0`.

## Performance Considerations

Po nieudanym alarmie kolejna próba czeka co najmniej minutę, więc padnięty kanał alarmów dokłada najwyżej jedną próbę na minutę na typ, każdą do 30 s (`socketTimeout`), zamiast próby przy każdej porażce. Stan to mapa o kilku kluczach (zamknięty zbiór `MailType`).

## Migration Notes

Bez zmian schematu i bez migracji. Wdrożenie wymaga nowych kluczy w `shared/.env` na serwerze przed merge'em. Bez nich deploy padnie już na `migration:run` w `deploy.sh` (`src/database/data-source.ts:14` woła `validateEnv`), a gdyby migracje przeszły, API nie wystartuje; w obu przypadkach deploy wycofa się do poprzedniego wydania. Skrypty `admin:*` i `superadmin:*` (`src/cli/role-script.ts:36`) i watchdog też wymagają tych kluczy. Wycofanie zmiany: poprzednie wydanie przyjmuje te klucze (już je czyta), więc nie trzeba ich usuwać.

## References

- Roadmapa: `context/foundation/roadmap.md`, S-12; PRD v2: FR-020
- Audyt: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (L2, L3, J6, J10; §6 pkt 3)
- Transport: `backend-subtracker/src/mail/mail.transport.ts:95-112`
- Env: `backend-subtracker/src/config/env.ts:161-173`, `:219-232`
- Alarm i odrzucenia: `backend-subtracker/src/mail/services/mail.service.ts:41-49`, `:171-183`, `:212-235`
- Watchdog: `backend-subtracker/src/cli/watchdog.ts:92-117`, `deploy/mydevil/watchdog.sh:98-109`
- Wzorzec testu blokady: `backend-subtracker/src/mail/services/mail.service.spec.ts:214-236`
- Poprzedni slice: `context/archive/2026-11-22-operator-liveness-alerts/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Osobny kanał alarmów w PROD

#### Automated

- [x] 1.1 Testy env i skryptu testowego — 21aa1b5
- [x] 1.2 Celowe uszkodzenie walidacji kanału czerwieni test — 21aa1b5
- [x] 1.3 Pełne testy backendu — 21aa1b5
- [x] 1.4 Testy e2e backendu — 21aa1b5
- [x] 1.5 Lint i build backendu — 21aa1b5

#### Manual

- [x] 1.6 Lokalnie `operator:test-mail` z nowej skrzynki — 21aa1b5

### Phase 2: Alarm o nieudanej wysyłce

#### Automated

- [x] 2.1 Testy poczty — bd04c54
- [x] 2.2 Celowe uszkodzenie blokady albo klasyfikacji czerwieni test — bd04c54
- [x] 2.3 Pełne testy backendu — bd04c54
- [x] 2.4 Testy e2e backendu — bd04c54
- [x] 2.5 Lint i build backendu — bd04c54

#### Manual

- [x] 2.6 Lokalnie błędne `SMTP_PASSWORD` daje jeden alarm `MAGIC_LINK` — bd04c54

### Phase 3: Dokumentacja i produkcja

#### Automated

- [x] 3.1 CI zielone na PR — f43f3de

#### Manual

- [x] 3.2 Klucze `NOTIFICATION_SMTP_*` w `shared/.env` przed merge'em
- [ ] 3.3 Po deployu `/health` 200 i `operator-test-mail.js` z `exit 0`
- [ ] 3.4 Watchdog bez `cannot run` po deployu
