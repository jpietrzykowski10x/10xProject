# Usunięcie konta (S-10) — plan implementacji

## Overview

Zalogowany użytkownik sam usuwa swoje konto na nowej stronie `/account`. Potwierdza to w dialogu, wpisując własny adres e-mail. Usunięcie jest natychmiastowe i twarde: jedna transakcja usuwa wiersz `user`, a z nim kaskadowo sesje, tokeny logowania, role, subskrypcje, własne kategorie, ustawienia kategorii i ustawienia budżetu. W tej samej transakcji wiersze `mail` z adresem konta zostają zanonimizowane: `recipient` dostaje stały znacznik `zanonimizowano@anonymized.invalid`, a `error_message` wartość `NULL`. Archiwum wysyłek (typy, statusy, daty) zostaje. Odpowiedź czyści ciasteczko sesji, a front przechodzi na `/` z komunikatem „Konto zostało usunięte”. Od tej zmiany mail do użytkownika wychodzi tylko wtedy, gdy konto z tym adresem nadal istnieje. Kopie bazy na serwerze starsze niż 180 dni są usuwane.

## Current State Analysis

- Kodu usuwania użytkownika nie ma (`research.md`, Summary). Jest tylko `revoke(token)` jednej sesji i `clearCookie` (`backend-subtracker/src/auth/services/session.service.ts:100-116`).
- `subscription`, `category` (własne), `category_setting` i `budget_settings` mają `ON DELETE CASCADE` na `user_id`. `session`, `magic_link_token` i `user_role` mają `NO ACTION` (`1793732263880-AuthAndMailSchema.ts:26,32,35`).
- `mail` trzyma adres w `recipient` bez klucza obcego (`src/mail/entities/mail.entity.ts:11-12`; komentarz zakłada sprzątanie, a ta zmiana go poprawia).
- `MailService.sendToUser` (`src/mail/services/mail.service.ts:65-80`) to jedyna droga maili do użytkowników: link logowania (`auth.service.ts:192-205`, bez `await`) i przypomnienie o trialu (`trial-reminder.service.ts:148`).
- `requestLink`/`register` blokują wiersz `user` (`lockActiveUser`, `auth.service.ts:157-166`, `pessimistic_write`).
- Frontend: brak strony konta. Wylogowanie to `auth.logout()` → `totals.clear()` → nawigacja (`layout/app-shell/app-shell.ts:36-49`). Wzorzec dialogu potwierdzenia: `subscriptions/delete-subscription-dialog/delete-subscription-dialog.ts:29-95`. Interceptor 401 pomija `${apiUrl}/auth/` (`auth/session-expired.interceptor.ts:15-31`).

## Desired End State

- `POST /auth/delete-account` z body `{ email }` (adres zalogowanego konta, porównany po normalizacji) usuwa konto i zwraca 204 z wyczyszczonym ciasteczkiem. Inny adres daje 400 i nic nie usuwa. Brak sesji daje 401, a obcy `Origin` 403 (CSRF).
- Po usunięciu nie ma żadnego wiersza z `user_id` konta w `session`, `magic_link_token`, `user_role`, `subscription`, `category`, `category_setting` i `budget_settings`. Kategorie domyślne i dane innych kont są nietknięte.
- W `mail` nie ma żadnego wiersza z adresem usuniętego konta. Jego dawne wiersze istnieją dalej (ta sama liczba, typy, statusy, daty) z `recipient = 'zanonimizowano@anonymized.invalid'` i `error_message = NULL`. Wiersze innych adresów są nietknięte.
- Stare ciasteczko daje 401 na każdej trasie chronionej. Ten sam adres może założyć nowe, puste konto.
- `MailService.sendToUser` nie wysyła maila na adres, którego nie ma w `user`, nie zapisuje dla niego wiersza audytu i zwraca `false`. Jeśli konto zniknęło w trakcie wysyłki (po sprawdzeniu, przed zapisem audytu), wiersz audytu dostaje znacznik zamiast adresu.
- Na serwerze nie ma dumpu bazy (deploy i `pre-restore`) starszego niż 180 dni: przycina je `prune-backups.sh`, wołany z `deploy.sh`, `restore-db.sh` i codziennie z crontaba.
- W `backups/` zawsze jest dump młodszy niż 30 dni. Gdy go nie ma (np. miesiąc bez deployu), skrypt najpierw robi profilaktyczny świeży dump, a dopiero potem usuwa stare. Gdy dump się nie uda, nie usuwa niczego. Przycinanie nigdy więc nie zostawi `backups/` bez kopii, a dane do odtworzenia po awarii nie są starsze niż miesiąc (plus dzienna kopia MyDevil).
- Na froncie adres e-mail w obu nawigacjach jest linkiem do `/account` (decyzja właściciela po fazie 2: bez osobnego linku „Konto”). Tam przycisk „Usuń konto” otwiera dialog, który pozwala usunąć konto dopiero po wpisaniu własnego adresu. Po usunięciu użytkownik ląduje na `/` z komunikatem.

### Key Discoveries:

- Usunięcie wiersza `user` w transakcji, która najpierw blokuje go `FOR UPDATE`, ustawia w kolejce równoległe `requestLink`/`register`. Po usunięciu `lockActiveUser` zwraca `null`, więc dla usuniętego konta nie powstanie token (`auth.service.ts:157-166`).
- Rezerwacja przypomnień o trialu po `user_id` zwraca 0 wierszy dla usuniętego konta (`trial-reminder.service.ts:124-136`). Wąskie okno „zarezerwowano, potem usunięto” zamyka sprawdzenie istnienia konta w `sendToUser`.
- Indeksy pod kaskadę już są: `session.user_id` i `magic_link_token.user_id` (migracja `AddAuthUserIdIndexes`), a `user_role.user_id` to pierwsza kolumna PK. `mail.recipient` indeksu nie ma (`mail.entity.ts`), a anonimizacja i sprawdzenie w `MailService` filtrują po tej kolumnie, więc dostaje indeks (lekcja o indeksach).
- `rollback.sh` przy brakującym dumpie kończy się komunikatem „backup not found; nothing changed” (`deploy/mydevil/rollback.sh:67-71`), więc przycinanie po wieku nie psuje skryptu. Rollback wydania starszego niż 180 dni zostaje po prostu odmówiony.
- `restore-db.sh` przycina swoje dumpy przed `pg_restore` (`restore-db.sh:55-59`). Przycinanie po wieku w tym miejscu mogłoby usunąć sam przywracany `$DUMP`.
- `clearCookie` używa tych samych opcji (z `Domain`) co ustawienie ciasteczka (`session.service.ts:52-58,114-116`).

## What We're NOT Doing

- Karencji ani cofania usunięcia (decyzja: natychmiast).
- Usuwania wierszy `mail` ani zamazywania adresu z zachowaniem fragmentów (np. `j***@gmail.com`): to pseudonimizacja, która w małej bazie nadal wskazuje osobę. Stały znacznik w poprawnym formacie adresu daje prawdziwą anonimizację i przechodzi każde sprawdzenie formatu.
- Ograniczenia `CHECK` formatu adresu w kolumnach `user.email` i `mail.recipient`: DTO już sprawdzają format (`IsEmail`, `MaxLength`, `request-link.dto.ts`), a wyrażenie w SQL różniłoby się od class-validator. Znacznik anonimizacji jest z takim ograniczeniem zgodny, gdyby kiedyś powstało.
- Maila „konto zostało usunięte” (decyzja: nie wysyłamy).
- Wpływu na dzienną kopię MyDevil: jej retencji nie kontrolujemy. Opisuje ją README.
- Pełnej polityki prywatności: to osobna praca przed publicznym startem. README zapisuje, co polityka ma powiedzieć o kopiach bazy (do 180 dni) i anonimizacji maili.
- Blokady usunięcia konta z rolą `ADMIN`: rolę nadaje CLI, więc operator może ją nadać ponownie.
- Wspólnej funkcji „unieważnij wszystkie sesje” dla S-09: przy twardym usunięciu sesje znikają kaskadą, a blokada w S-09 zaprojektuje własną.
- Upraszczania istniejących sprzątań e2e (`test/support/e2e-app.ts:158-172`, `e2e/support/accounts.ts:157-170`) i testu kaskady z S-02. Po migracji nadal działają.

## Implementation Approach

Backend najpierw, bo front i e2e przeglądarki zależą od trasy. Migracja zamienia 3 klucze obce na `CASCADE` i dodaje indeks `mail.recipient`, więc usunięcie konta to `UPDATE mail` i `DELETE` na zablokowanym wierszu `user`. Każde przyszłe usunięcie użytkownika (np. S-09) ma tę samą gwarancję kaskady w schemacie. Potwierdzenie adresem jest sprawdzane w dialogu (przycisk) i w API (400), bo API nie ufa klientowi. Sprawdzenie istnienia konta siedzi w `MailService.sendToUser`, jedynym wspólnym punkcie wysyłek do użytkowników, więc obejmuje też przyszłe joby z mailem. Przycinanie kopii bazy po wieku to zmiana skryptów serwera i crontaba, wgrywanych ręcznie, więc trafia do fazy 3.

## Critical Implementation Details

**Timing & lifecycle** — W transakcji najpierw `SELECT … FOR UPDATE` wiersza `user` (to samo co `lockActiveUser`), potem porównanie adresu, potem anonimizacja `mail`, potem `DELETE`. Porównanie przed blokadą zostawiłoby okno, w którym `requestLink` wyda token kontu, które zaraz zniknie. Kaskada z tokenem i tak by go usunęła, ale mail z linkiem by wyszedł. Wysyłka trwająca w chwili usunięcia zapisuje audyt po commicie, dlatego `MailService` sprawdza konto drugi raz przed zapisem audytu i wtedy zapisuje znacznik. Wąskie okno między tym sprawdzeniem a zapisem zostaje jako przyjęte ryzyko.

**Kolejność w `restore-db.sh`** — przycinanie po wieku idzie dopiero po udanym przywróceniu i nigdy nie obejmuje przywracanego `$DUMP` ani świeżego `pre-restore`.

**Nigdy bez kopii** — `prune-backups.sh` najpierw sprawdza, czy jest dump młodszy niż `FRESH_DUMP_DAYS=30`. Jeśli nie ma, robi świeży `pg_dump` (profilaktyczny dump co miesiąc), a kasuje dopiero po jego sukcesie. Próg 30 < 180 sprawia, że po przycięciu zawsze zostaje co najmniej jedna kopia. Nieudany dump oznacza: nic nie usunięto, kod wyjścia 1. Ścieżka z crontaba bierze blokadę `.ops.lock` (wspólną z `deploy.sh`, `rollback.sh` i `restore-db.sh`), więc nie dubluje się z deployem ani przywracaniem. Gdy blokada jest zajęta, kończy się bez zmian, bo trwający deploy albo przywrócenie przytnie kopie samo.

**State sequencing (front)** — Po 204: `AuthService` zeruje użytkownika, potem `totals.clear()`, potem nawigacja na `/` ze stanem `{ accountDeleted: true }`. Na `/` w przeglądarce `guestGuard` odpytuje `/auth/session`, dostaje `null` i przepuszcza. Komunikat bierze się ze stanu nawigacji. Router zapisuje ten stan we wpisie historii i odtwarza go po odświeżeniu, więc `Home` po pokazaniu komunikatu usuwa flagę z wpisu (`afterNextRender`, `Location.replaceState`); odświeżenie strony usuwa komunikat (zamierzone, znalezione w ręcznym sprawdzeniu 2.6).

## Phase 1: Backend: usuwanie konta

### Overview

Migracja kaskady i indeksu, trasa usuwania konta z anonimizacją `mail`, sprawdzanie istnienia konta przed wysyłką maila, testy i opis wzorca.

### Changes Required:

#### 1. Kaskada od `user` dla tabel auth i indeks `mail.recipient`

**File**: `backend-subtracker/src/auth/entities/session.entity.ts`, `src/auth/entities/magic-link-token.entity.ts`, `src/users/entities/user-role.entity.ts`, `src/mail/entities/mail.entity.ts`, nowa migracja w `src/database/migrations/`

**Intent**: Relacje `user` w trzech encjach auth dostają `onDelete: 'CASCADE'`, a `Mail.recipient` dostaje `@Index()`. Migracja wygenerowana względem `subtracker-db` przepina klucze obce i zakłada indeks, więc usunięcie wiersza `user` usuwa wszystko, co do niego należy, a filtr po adresie w `mail` nie skanuje całej tabeli.

**Contract**: `npm run migration:generate -- AccountDeletionSchema`. Migracja zawiera tylko `DROP CONSTRAINT` + `ADD CONSTRAINT … ON DELETE CASCADE` dla `session.user_id`, `magic_link_token.user_id` i `user_role.user_id` oraz `CREATE INDEX` na `mail.recipient`, bez innych różnic. Przed commitem przegląd pliku i `npm run migration:run` (lekcja o migracjach). Relacje zostają w formie `Relation<User>` / `() => User` (lekcja o ESM).

#### 2. Serwis usuwania konta

**File**: `backend-subtracker/src/auth/services/account-deletion.service.ts` (nowy), `src/auth/auth.module.ts`, `src/mail/mail.types.ts` (albo plik stałych modułu `mail`)

**Intent**: `delete(userId, confirmedEmail)` w jednej transakcji blokuje wiersz `user` i sprawdza, czy `normalizeEmail(confirmedEmail)` równa się adresowi konta. Potem anonimizuje wiersze `mail` z adresem konta i usuwa wiersz `user`. Resztę robi kaskada.

**Contract**: `delete(userId: string, confirmedEmail: string): Promise<void>`. Anonimizacja: `UPDATE mail SET recipient = ANONYMIZED_RECIPIENT, error_message = NULL WHERE recipient = <adres konta>`. Stała `ANONYMIZED_RECIPIENT = 'zanonimizowano@anonymized.invalid'` jest eksportowana z modułu `mail` (stała domeny maili, nie `shared/`); mieści się w `varchar(254)` i jest poprawnym adresem. Niezgodny adres → `BadRequestException` (bez zmian w bazie). Brak wiersza (np. drugie równoległe żądanie) → `UnauthorizedException`, spójnie z wygasłą sesją. Rejestracja w `providers` `AuthModule`.

#### 3. Trasa `POST /auth/delete-account`

**File**: `backend-subtracker/src/auth/controllers/auth.controller.ts`, `src/auth/dtos/delete-account.dto.ts` (nowy)

**Intent**: Trasa dla zalogowanego użytkownika (bez `@Public()`), która woła serwis i czyści ciasteczko, jak `logout`.

**Contract**: `POST /auth/delete-account`, `@HttpCode(204)`, body `DeleteAccountDto { email: string }` (wymagany niepusty string; transform przez `normalizeEmail` jak w `request-link.dto.ts`), `@CurrentUser()`, `@Res({ passthrough: true })` + `sessions.clearCookie(response)` po sukcesie. CSRF działa automatycznie (`backend-patterns.md`, „Ochrona CSRF”).

#### 4. Mail tylko na adres istniejącego konta

**File**: `backend-subtracker/src/mail/services/mail.service.ts`, `src/mail/mail.module.ts`, `src/mail/entities/mail.entity.ts` (komentarz)

**Intent**: `sendToUser` przed wysyłką sprawdza, czy w `user` jest wiersz z adresem `to`. Jeśli go nie ma, nie wysyła, nie zapisuje audytu i nie alarmuje operatora. Loguje to bez adresu i zwraca `false`. Po wysyłce, przed zapisem audytu, sprawdza konto drugi raz. Jeśli zniknęło w trakcie, audyt dostaje `ANONYMIZED_RECIPIENT` i `error_message = NULL`. Komentarz encji `mail` mówi teraz, że tabela jest archiwum, a usunięcie konta je anonimizuje.

**Contract**: `MailModule` importuje `TypeOrmModule.forFeature([Mail, User])`. Sprawdzenie to `exists({ where: { email: to } })` (adresy są zapisane po `normalizeEmail`). Dotyczy tylko kanału `user`; `notifyOperator` bez zmian. Kontrakt `sendToUser`: „nigdy nie odrzuca” zostaje. Błąd zapytania o konto przed wysyłką traktujemy jak brak konta (log `message`, `false`), a przy zapisie audytu jak usunięte konto (znacznik).

#### 5. Testy backendu

**File**: `backend-subtracker/test/auth/account-deletion.e2e-spec.ts` (nowy), `test/routes.e2e-spec.ts`, `src/mail/services/mail.service.spec.ts`

**Intent**: Test API dowodzi, że po usunięciu nic po koncie nie zostaje, a archiwum `mail` nie zawiera już jego adresu (ryzyka #1 i #6 z `test-plan.md`). Testy jednostkowe dowodzą, że na adres bez konta mail nie wychodzi, a audyt wysyłki przerwanej usunięciem nie zapisuje adresu.

**Contract**:
- e2e (`createE2eApp({ addressPrefix })`, `signIn()`, `repository(Entity)`): konto z subskrypcją, własną kategorią, `category_setting`, `budget_settings`, rolą, drugą sesją i nieużytym tokenem, oraz wiersz `mail` `FAILED` z adresem w `error_message` (wstawiony przez `failMailTo` albo repozytorium) → 204 i `Set-Cookie` czyszczące ciasteczko. Zero wierszy z `user_id` w 7 tabelach. Zero wierszy `mail` z adresem w `recipient`; liczba wierszy `mail` bez zmian, a dawne wiersze konta mają znacznik i `error_message IS NULL`. Wiersze `mail` drugiego konta, kategorie domyślne i dane drugiego konta nietknięte. Stare ciasteczko → 401 na `GET /auth/me` i `GET /subscriptions`. Druga sesja tego konta też 401.
- e2e: zły adres → 400 i konto oraz dane bez zmian; adres podany wielkimi literami ze spacjami → 204 (normalizacja); brak ciasteczka → 401; obcy `Origin` → 403, `CORS_ORIGINS[0]` przechodzi.
- e2e: po usunięciu `POST /auth/register` tym samym adresem tworzy nowe konto (nowe `id`, brak starych subskrypcji). `POST /auth/request-link` dla usuniętego adresu nie wysyła maila (`sent` pusty).
- `routes.e2e-spec.ts`: `POST /auth/delete-account` w `EXPECTED_ROUTES` z `access: 'session'`.
- `mail.service.spec.ts`: brak konta → transport nie wołany, brak `save`, wynik `false`; konto istnieje → dotychczasowe zachowanie; konto znika między wysyłką a zapisem audytu → audyt z `ANONYMIZED_RECIPIENT` i bez `errorMessage`.

#### 6. Wzorzec w dokumentacji backendu

**File**: `context/foundation/backend-patterns.md`

**Intent**: Nowy punkt „Usuwanie konta (S-10)” opisuje kaskadę od `user` (teraz także tabele auth), blokadę wiersza przed usunięciem i anonimizację archiwum `mail` stałym znacznikiem w formacie adresu (dlaczego nie zamazywanie). Opisuje też regułę „mail tylko na adres istniejącego konta”, z drugim sprawdzeniem przed zapisem audytu. Poprawia zdanie o kaskadzie w „Dane domenowe”.

**Contract**: sekcje „Dane domenowe” (punkt „Kaskada od użytkownika”) i „Maile”.

### Success Criteria:

#### Automated Verification:

- Migracja `AccountDeletionSchema` przechodzi na `subtracker-db`: `npm run migration:run`, a `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- Lint backendu przechodzi: `npm run lint`
- Build backendu przechodzi: `npm run build`
- Testy jednostkowe przechodzą: `npm test`
- Testy e2e API przechodzą, w tym `test/auth/account-deletion.e2e-spec.ts` i `test/routes.e2e-spec.ts`: `npm run test:e2e`

#### Manual Verification:

- Przegląd wygenerowanej migracji: tylko 3 klucze obce i indeks `mail.recipient`, `down()` przywraca `NO ACTION` i usuwa indeks
- `curl` na lokalne API z ciasteczkiem z `dev-local/test-session.mjs create` i złym adresem daje 400, a z dobrym 204, konto znika w `subtracker-db-dev`, a jego wiersze `mail` mają znacznik

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 2: Frontend: strona `/account` i dialog

### Overview

Strona konta z dialogiem usunięcia, link w nawigacjach, komunikat na stronie startowej, trasy i testy jednostkowe.

### Changes Required:

#### 1. `AuthService.deleteAccount`

**File**: `frontend-subtracker/src/app/auth/auth.service.ts`

**Intent**: Metoda wysyła żądanie usunięcia i po sukcesie zeruje bieżącego użytkownika, jak `logout()`.

**Contract**: `deleteAccount(email: string): Observable<void>` → `POST ${apiUrl}/auth/delete-account` z `{ email }`, `tap(() => user.set(null))`.

#### 2. Dialog usunięcia konta

**File**: `frontend-subtracker/src/app/pages/account/delete-account-dialog/` (nowy komponent: `.ts`, `.html`, `.scss`, `.spec.ts`)

**Intent**: Dialog wg wzorca `delete-subscription-dialog`: `role: 'alertdialog'`, fokus na „Anuluj”, ostrzeżenie, że subskrypcje, własne kategorie, limity i ustawienia przepadną bezpowrotnie, a usunięcia nie da się cofnąć. Pole „Wpisz swój adres e-mail, aby potwierdzić” (style `_forms.scss`, `shared/form-field-defaults.ts`). Przycisk „Usuń konto” jest aktywny tylko wtedy, gdy wpisany adres po `trim()` i zmianie na małe litery równa się adresowi konta. Dialog sam wysyła żądanie, blokuje się w trakcie i zamyka z wynikiem `true` po sukcesie.

**Contract**: dane dialogu `{ email: string }`, wynik `boolean`. Błędy jako `st-notice--error` w dialogu: 400 → „Adres nie zgadza się z adresem konta.”, 401 → zamknięcie dialogu i nawigacja na `/sign-in` (interceptor nie obsługuje `/auth/`), inne → „Serwis jest chwilowo niedostępny. Konto nie zostało usunięte, spróbuj ponownie za chwilę.”

#### 3. Strona `/account`

**File**: `frontend-subtracker/src/app/pages/account/account.ts`, `.html`, `.scss`, `.spec.ts` (nowe)

**Intent**: Strona w app-shell z nagłówkiem „Konto”, adresem e-mail użytkownika i sekcją „Usuń konto” (krótki opis i przycisk). Po wyniku `true` dialogu: `totals.clear()` i nawigacja na `/` ze stanem `{ accountDeleted: true }`. Strona nie ma długiej listy, więc przewija się w obszarze treści jak `/budget`.

**Contract**: użytkownik z `AuthService.currentUser`. Nawigacja: `router.navigate(['/'], { state: { accountDeleted: true } })`.

#### 4. Trasy i tryb renderowania

**File**: `frontend-subtracker/src/app/app.routes.ts`, `src/app/app.routes.server.ts`, `e2e/http/render-modes.e2e-spec.ts`

**Intent**: `/account` z `authGuard` po `budget`, `RenderMode.Client` przed `'**'`, a `/account` dochodzi do `GUARDED_ROUTES` (CLAUDE.md, Tripwires).

**Contract**: ścieżka `account` (lekcja: trasy po angielsku).

#### 5. Adres e-mail jako link do `/account`

**File**: `frontend-subtracker/src/app/layout/app-shell/app-shell.html`, `app-shell.scss`, `app-shell.spec.ts`

**Intent**: W `.shell__account` (desktop) i w `mat-menu` (telefon) sam adres e-mail jest linkiem do `/account` (bez osobnego linku „Konto”, decyzja właściciela po fazie 2) z `routerLinkActive` i `ariaCurrentWhenActive="page"`. `NAV_LINKS` zostaje bez zmian.

**Contract**: oba linki na `/account`. Style z tokenów `--st-*` istniejących w `_theme.scss`.

#### 6. Komunikat na stronie startowej

**File**: `frontend-subtracker/src/app/pages/home/home.ts`, `home.html`, `home.spec.ts`

**Intent**: Gdy bieżąca nawigacja niesie `accountDeleted: true`, nad treścią pojawia się `st-notice` z `role="status"`: „Konto zostało usunięte razem ze wszystkimi danymi.” Na serwerze i przy zwykłym wejściu komunikatu nie ma.

**Contract**: odczyt `inject(Router).currentNavigation()?.extras.state` przy tworzeniu komponentu. Bez query paramów i bez pamięci przeglądarki.

#### 7. Testy jednostkowe frontu

**File**: `delete-account-dialog.spec.ts`, `account.spec.ts`, `app-shell.spec.ts`, `home.spec.ts`, `auth/auth.service` (spec, jeśli istnieje wzór; inaczej w spec dialogu przez `HttpTestingController`)

**Intent**: Przycisk jest nieaktywny przy pustym i obcym adresie, a aktywny przy właściwym (także z wielkimi literami i spacjami). Żądanie idzie z adresem z pola. Działa blokada w trakcie i 3 warianty błędu. Strona po sukcesie czyści sumy i nawiguje ze stanem. Shell linkuje `/account` z adresu w obu nawigacjach. Home pokazuje komunikat tylko ze stanem.

**Contract**: wg `test-plan.md` §6.1–6.2.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe frontu przechodzą w obu strefach czasowych: `npm run test:ci`
- Build produkcyjny przechodzi: `npm run build`
- Test trybów renderowania z `/account` w `GUARDED_ROUTES` przechodzi: `npm run build:e2e && npx playwright test --project=http`

#### Manual Verification:

- Na desktopie i w widoku telefonu (< 840px) adres e-mail jest linkiem do `/account`, a `/account` wygląda spójnie z `/budget`
- Dialog: fokus startuje na „Anuluj”, Esc zamyka, przycisk „Usuń konto” włącza się dopiero po wpisaniu własnego adresu
- Po usunięciu jest strona startowa z komunikatem, odświeżenie usuwa komunikat, a wejście na `/subscriptions` przekierowuje na `/sign-in`

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 3: E2E przeglądarki i dokumentacja

### Overview

Test Playwright całego przepływu na prawdziwym API, przycinanie kopii bazy po wieku (180 dni) i dokumentacja: README deployu, CLAUDE.md.

### Changes Required:

#### 1. Test e2e przeglądarki

**File**: `frontend-subtracker/e2e/browser/account-deletion.e2e-spec.ts` (nowy)

**Intent**: Pełny przepływ: konto z subskrypcją (`createE2eAccounts`, `newAccount()`, ciasteczko przez `sessionFor()`), wejście przez link z adresem e-mail, dialog `getByRole('alertdialog', { name })`, nieaktywny przycisk przy obcym adresie, wpisanie właściwego, usunięcie, komunikat na `/`, a potem `/subscriptions` → `/sign-in`. Sprzątanie danych testu działa też wtedy, gdy konto już nie istnieje.

**Contract**: wg `test-plan.md` §6.5, projekt `chromium`.

#### 2. Skrypt `prune-backups.sh`: kopie starsze niż 180 dni, ale nigdy żadnej kopii

**File**: `deploy/mydevil/prune-backups.sh` (nowy), `deploy/mydevil/deploy.sh`, `deploy/mydevil/restore-db.sh`

**Intent**: Jeden skrypt usuwa pliki `*.dump` w `backups/` starsze niż 180 dni, więc kopia z danymi usuniętego konta nie żyje dłużej niż pół roku. Działa niezależnie od deployów. Gwarantuje przy tym, że zawsze zostaje kopia, z której da się odtworzyć bazę, i że nie jest starsza niż miesiąc: gdy żaden dump nie jest młodszy niż 30 dni, najpierw robi świeży (Critical Implementation Details, „Nigdy bez kopii”). Obecna rotacja po liczbie (10 + 10) zostaje.

**Contract**:
- Wywołanie: `prune-backups.sh [plik-do-zachowania]`. Argument to ścieżka, której nie wolno usunąć (przywracany `$DUMP` w `restore-db.sh`).
- Kroki:
  1. Blokada `.ops.lock`, chyba że `SUBTRACKER_LOCKED=1`; zajęta blokada → wyjście 0 z komunikatem.
  2. Jeśli w `backups/` nie ma `*.dump` młodszego niż `FRESH_DUMP_DAYS=30` (`find … -mtime -30`): `pg_dump -Fc` do `backups/<YYYYmmdd-HHMMSS>_scheduled.dump`, z `umask 077`, hasłem przez `PGPASSWORD` i env z `~/apps/subtracker/api/shared/.env`, jak w `restore-db.sh:24-29`. Błąd → usunięcie niepełnego pliku, nic nie skasowane, wyjście 1.
  3. `find "$BACKUPS" -maxdepth 1 -name '*.dump' -mtime +"$BACKUP_MAX_AGE_DAYS"` (`BACKUP_MAX_AGE_DAYS=180`) z pominięciem argumentu, potem `-delete`.
- Zmienne `SUBTRACKER_BACKUPS` i `SUBTRACKER_ENV_FILE` nadpisują domyślne ścieżki serwera; służą tylko do lokalnej próby (Manual Verification).
- `deploy.sh` (tylko `APP=api`, po obecnej rotacji po liczbie) i `restore-db.sh` (po udanym przywróceniu, z argumentem `$DUMP`) wołają go z `SUBTRACKER_LOCKED=1`. Jego błąd tylko loguje i nie cofa udanego deployu ani przywrócenia.
- `_scheduled.dump` nie pasuje do wzorca `_pre-restore`, więc wpada do rotacji dumpów deployu (najnowsze 10). `rollback.sh` czyta dump z `.deploy-info`, więc go nie dotyczy.
- Skrypty wgrywa się ręcznie przez `scp` (CLAUDE.md).
- Wykonanie (odstępstwo, przegląd fazy 3 F1): krok 3 to pętla `while read` po wyniku `find … -mtime +180` (here-document, nie potok; `for` po `find` odrzuca shellcheck SC2044 w CI) z `rm -f` i logiem każdego usuniętego pliku zamiast `-delete`; zachowywany plik porównywany przez `=` i `-ef`. Błąd utworzenia blokady inny niż „zajęta” kończy skrypt kodem 1.

#### 3. Codzienne przycinanie w crontabie i opis w README

**File**: `deploy/mydevil/README.md`

**Intent**: W „One-time setup” → crontab dochodzi codzienny wpis z `prune-backups.sh`, żeby kopie znikały po 180 dniach także bez deployu. Nowa sekcja o kopiach i usuwaniu kont mówi, że:
- dumpy deployu i `pre-restore` żyją najwyżej 180 dni (liczba i wiek), a gdy przez 30 dni nie powstał żaden dump, cron robi profilaktyczny `_scheduled.dump`, więc zawsze jest kopia nie starsza niż miesiąc;
- nieudany dump w cronie oznacza, że nic nie skasowano; gdzie szukać komunikatu;
- rollback wydania, którego dump już usunięto, jest odmówiony, a do odtworzenia po awarii służy najnowszy dump i `restore-db.sh`;
- dzienna kopia MyDevil ma retencję, której nie kontrolujemy;
- przywrócenie kopii albo rollback przywraca konta usunięte po jej wykonaniu, więc operator musi ponowić te usunięcia;
- archiwum `mail` jest anonimizowane przy usunięciu konta.

Sekcja kończy się listą tego, co pełna polityka prywatności ma o tym powiedzieć.

**Contract**: wpis crontab z pełnymi ścieżkami, np. `30 4 * * * /usr/home/<login>/apps/subtracker/bin/prune-backups.sh >> /usr/home/<login>/apps/subtracker/api/logs/prune-backups.log 2>&1`. Plik trafia do katalogu logów objętego istniejącym `truncate`.

#### 4. CLAUDE.md

**File**: `CLAUDE.md` (część „Repository notes”, poza blokiem 10x-cli)

**Intent**: W Tripwires lista tras `Client` zawiera `account`. W Architecture backend wymienia `POST /auth/delete-account`, anonimizację `mail` i regułę „mail tylko na adres istniejącego konta”, a akapit o deployu wspomina przycinanie kopii po 180 dniach.

**Contract**: tylko te zdania.

### Success Criteria:

#### Automated Verification:

- E2E przeglądarki przechodzi, w tym `account-deletion.e2e-spec.ts`: `npm run build:e2e && npm run e2e`
- Pełne testy backendu nadal przechodzą: `npm test && npm run test:e2e` (w `backend-subtracker/`)
- Skrypty serwera przechodzą kontrolę składni: `sh -n` dla `deploy.sh`, `restore-db.sh` i `prune-backups.sh`

#### Manual Verification:

- Sekcja w `deploy/mydevil/README.md` jest zrozumiała dla operatora bez czytania planu
- Po deployu na produkcję: usunięcie testowego konta działa, a ponowna rejestracja tym adresem daje puste konto
- Na serwerze: `deploy.sh`, `restore-db.sh` i `prune-backups.sh` wgrane przez `scp`, wpis crontab dodany, a pierwsze uruchomienie ręczne kończy się bez błędu
- Lokalna próba `prune-backups.sh` (`SUBTRACKER_BACKUPS` na katalogu testowym, `SUBTRACKER_ENV_FILE` na lokalną bazę dev) w czterech przypadkach. Same pliki starsze niż 180 dni (postarzone `touch -t`): powstaje `_scheduled.dump`, a dopiero potem znikają stare. Najnowszy dump ma 40 dni: powstaje `_scheduled.dump`, a nic nie znika. Nieudany `pg_dump` (złe hasło): żaden plik nie znika. Jest dump młodszy niż 30 dni: brak nowego dumpu, znikają tylko pliki starsze niż 180 dni

### Addendum (2026-11-21, przegląd fazy 3 F2)

- 3.7 wykonane stałym skryptem `dev-local/prune-backups-trial.sh` (7 przypadków, sprawdzenia PASS/FAIL, do ponownego uruchamiania po zmianie `prune-backups.sh`). Prawdziwy dump w próbie czyta bazę referencyjną `subtracker-db` (`POSTGRES_DATABASE` z `.env`, tylko odczyt), a nie bazę dev.
- Poza S-10, na prośbę właściciela (commit 7ede133): nasze README dwujęzyczne (PL/EN) i spięte z głównym; domena produkcyjna w dokumentacji i testach zastąpiona tokenami (`<frontend-domain>`, `<api-domain>`, `<parent-domain>`, `example.test`).

---

## Testing Strategy

### Unit Tests:

- `MailService.sendToUser`: adres bez konta → brak wysyłki i audytu, `false`; konto znika w trakcie → audyt ze znacznikiem.
- Dialog: włączanie przycisku po porównaniu adresu (normalizacja), blokada w trakcie, błędy 400/401/inne.
- Strona `/account`, link w shellu, komunikat na `/`.

### Integration Tests:

- API e2e: usunięcie czyści 7 tabel, anonimizuje wiersze `mail` konta (liczba bez zmian, zero wierszy z adresem), nie rusza kategorii domyślnych ani cudzych danych i maili. Stare ciasteczko i druga sesja → 401. Zły adres → 400 bez zmian. CSRF. Ponowna rejestracja tworzy puste konto. `request-link` dla usuniętego adresu nie wysyła maila.
- Trasy: `EXPECTED_ROUTES`, `GUARDED_ROUTES`.
- Przeglądarka: pełny przepływ od linku z adresem e-mail do przekierowania na `/sign-in`.

### Manual Testing Steps:

1. Zalogować się lokalnie, dodać subskrypcję i limit na `/budget`.
2. Kliknąć adres e-mail (desktop i telefon), otworzyć dialog, wpisać obcy adres (przycisk nieaktywny), potem własny.
3. Usunąć konto, sprawdzić komunikat na `/` i brak danych w `subtracker-db-dev` (wiersze `mail` zostają ze znacznikiem `zanonimizowano@anonymized.invalid`).
4. Zarejestrować się tym samym adresem i sprawdzić, że konto jest puste.

## Performance Considerations

Usunięcie to `UPDATE mail` po nowym indeksie `recipient` i jeden `DELETE` z kaskadą po indeksowanych kolumnach `user_id`. Sprawdzenie konta w `sendToUser` to dwa zapytania po unikalnym indeksie `email` na mail, czyli pomijalne obok SMTP.

## Migration Notes

Migracja `AccountDeletionSchema` zmienia definicje 3 kluczy obcych i zakłada indeks `mail.recipient`, bez zmian danych. Na produkcji wchodzi w `deploy.sh` po `pg_dump`. Cofnięcie to `restore-db.sh`, nie `migration:revert` (lekcja o migracjach).

## References

- Research: `context/changes/account-deletion/research.md`
- Roadmapa: `context/foundation/roadmap.md` (S-10), PRD NFR `context/foundation/prd.md:108`
- Wzorzec dialogu: `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/delete-subscription-dialog.ts:29-95`
- Wylogowanie: `backend-subtracker/src/auth/controllers/auth.controller.ts:79-91`, `frontend-subtracker/src/app/layout/app-shell/app-shell.ts:36-49`
- Blokada wiersza użytkownika: `backend-subtracker/src/auth/services/auth.service.ts:157-166`
- Test kaskady z S-02: `backend-subtracker/test/subscriptions/subscriptions.e2e-spec.ts:176-197`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend: usuwanie konta

#### Automated

- [x] 1.1 Migracja `AccountDeletionSchema` przechodzi na `subtracker-db`, a ponowne `migration:generate` nie znajduje zmian — 6116dfd
- [x] 1.2 Lint backendu przechodzi: `npm run lint` — 6116dfd
- [x] 1.3 Build backendu przechodzi: `npm run build` — 6116dfd
- [x] 1.4 Testy jednostkowe przechodzą: `npm test` — 6116dfd
- [x] 1.5 Testy e2e API przechodzą, w tym `account-deletion.e2e-spec.ts` i `routes.e2e-spec.ts`: `npm run test:e2e` — 6116dfd

#### Manual

- [x] 1.6 Przegląd wygenerowanej migracji: tylko 3 klucze obce i indeks `mail.recipient`, `down()` je cofa — ręcznie (właściciel)
- [x] 1.7 `curl` na lokalne API: zły adres 400, dobry 204, konto znika z `subtracker-db-dev`, a jego wiersze `mail` mają znacznik — ręcznie (właściciel); request-link na usunięte konto: 202, bez maila

### Phase 2: Frontend: strona `/account` i dialog

#### Automated

- [x] 2.1 Testy jednostkowe frontu przechodzą w obu strefach czasowych: `npm run test:ci` — 1d7f9fe
- [x] 2.2 Build produkcyjny przechodzi: `npm run build` — 1d7f9fe
- [x] 2.3 Test trybów renderowania z `/account` w `GUARDED_ROUTES` przechodzi — 1d7f9fe

#### Manual

- [x] 2.4 Adres e-mail jako link do `/account` na desktopie i telefonie, `/account` spójne z `/budget` — ręcznie (właściciel)
- [x] 2.5 Dialog: fokus na „Anuluj”, Esc zamyka, przycisk aktywny dopiero po wpisaniu własnego adresu — ręcznie (właściciel)
- [x] 2.6 Po usunięciu komunikat na `/`, odświeżenie go usuwa, `/subscriptions` przekierowuje na `/sign-in` — ręcznie (właściciel)

### Phase 3: E2E przeglądarki i dokumentacja

#### Automated

- [x] 3.1 E2E przeglądarki przechodzi, w tym `account-deletion.e2e-spec.ts` — a1c11da
- [x] 3.2 Pełne testy backendu nadal przechodzą — a1c11da
- [x] 3.3 Skrypty serwera (`deploy.sh`, `restore-db.sh`, `prune-backups.sh`) przechodzą kontrolę składni `sh -n` — a1c11da

#### Manual

- [ ] 3.4 Sekcja w `deploy/mydevil/README.md` zrozumiała dla operatora bez czytania planu
- [ ] 3.5 Po deployu: usunięcie testowego konta działa, ponowna rejestracja daje puste konto
- [x] 3.6 Na serwerze: trzy skrypty wgrane, wpis crontab dodany, pierwsze ręczne uruchomienie bez błędu — ręcznie (właściciel, 2026-11-21): chmod 700, sumy sha256 zgodne, crontab dodany, ręczne uruchomienie: `done: 0 dump(s) deleted`
- [x] 3.7 Lokalna próba `prune-backups.sh`: same stare kopie → najpierw świeży dump, potem kasowanie; najnowszy 40-dniowy → profilaktyczny dump; nieudany dump → nic nie znika; jest młodszy niż 30 dni → znikają tylko starsze niż 180 — `sh dev-local/prune-backups-trial.sh`: 7 przypadków, 30/30 PASS (2026-11-21)
