---
date: 2026-11-20T13:47:29+01:00
researcher: Claude (Opus 5.5)
git_commit: 8163e07
branch: change/account-deletion
repository: 10xProject (SubTracker)
topic: "S-10 account-deletion — co jest w kodzie i co trzeba rozstrzygnąć przed planem"
tags: [research, account-deletion, auth, session, mail, cascade, backups, app-shell]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude (Opus 5.5)
---

# Research: S-10 account-deletion

**Date**: 2026-11-20T13:47:29+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 8163e07
**Branch**: change/account-deletion
**Repository**: 10xProject (SubTracker)

## Research Question

Slice S-10 (`roadmap.md:246-259`): użytkownik sam usuwa konto; przed usunięciem widzi potwierdzenie, po usunięciu jest wylogowany, a jego sesje, tokeny logowania i dane domenowe znikają. NFR: dane osobowe/finansowe usunięte lub zanonimizowane w ciągu 30 dni od żądania (`prd.md:108`). Pytania: które tabele trzymają dane konta i jak dziś działa usuwanie (FK), co jest do ponownego użycia z sesji/wylogowania, gdzie postawić trasę i ekran, jakie wyścigi z jobami, co z `mail` i kopiami bazy, jak to testować.

## Summary

- **Usunięcie twarde jest wykonalne jednym `DELETE FROM "user"`, ale dopiero po wcześniejszym usunięciu wierszy w 3 tabelach z FK `NO ACTION`:** `session`, `magic_link_token`, `user_role` (`AuthAndMailSchema.ts:26,32,35`; żadna późniejsza migracja tego nie zmienia — sprawdzone `ON DELETE` we wszystkich migracjach). 4 tabele mają `CASCADE` na `user_id`: `subscription`, `category` (własne), `category_setting`, `budget_settings` (`SubscriptionsSchema.ts:23,26`, `CategorySetting.ts:14`, `BudgetSettings.ts:14`).
- **`mail` nie ma FK do `user`** i trzyma adres w `recipient` (oraz tekst błędu SMTP w `error_message`, który może zawierać adres) — komentarz encji wprost mówi, że usuwanie konta musi to objąć (`mail.entity.ts:10-11`). To jedyna tabela z adresem bez FK w sprawdzonych encjach.
- **Nie ma kodu usuwania użytkownika ani „unieważnij wszystkie sesje”.** Jest tylko `revoke(token)` jednej sesji i `clearCookie` (`session.service.ts:100-105,114-116`). Wzorzec kolejności usuwania istnieje w sprzątaniu e2e (`test/support/e2e-app.ts:158-172`).
- **Soft delete przez `is_active=false` byłby błędny dla S-10:** rejestracja robi `orIgnore` na unikalnym adresie (`auth.service.ts:123-154`), więc adres zablokowanego konta nie mógłby się zarejestrować ponownie, a dane zostałyby w bazie. `is_active` to mechanizm blokady z S-09.
- **Wyścig z mailami:** job przypomnień rezerwuje wiersze, a potem wysyła mail i zapisuje audyt (`trial-reminder.service.ts:124-150`, `mail.service.ts:137-159`); `register`/`requestLink` wysyłają po commicie bez `await` (`auth.service.ts:192-205`). Usunięcie konta w tym oknie może zostawić nowy wiersz `mail` z adresem już po usunięciu.
- **Kopie bazy:** deploy trzyma 10 najnowszych dumpów (`deploy.sh:27,209-217`) i 10 `pre-restore` (`restore-db.sh:32,55-69`), bez rotacji po wieku; MyDevil robi własną dzienną kopię o nieudokumentowanej retencji (`infrastructure.md:86`). Usunięte konto zostaje w kopiach i wraca po rollbacku (`rollback.sh:67-88`).
- **Frontend:** brak strony konta; naturalne miejsce to nowa trasa `/account` z `authGuard` i `RenderMode.Client`. Wzorzec potwierdzenia to `MatDialog` z `role: 'alertdialog'` z S-03, ale komponent nie jest ogólny — trzeba nowego dialogu. Polityka prywatności to placeholder, nic nie obiecuje (`privacy-policy.html:2-3`).

## Detailed Findings

### Tabele powiązane z użytkownikiem (backend)

| Tabela.kolumna | onDelete w encji | FK w migracji |
|---|---|---|
| `session.user_id` | brak → NO ACTION (`src/auth/entities/session.entity.ts:25`) | NO ACTION (`1793732263880-AuthAndMailSchema.ts:35`); indeks: migracja `AddAuthUserIdIndexes` |
| `magic_link_token.user_id` | brak → NO ACTION (`magic-link-token.entity.ts:23`) | NO ACTION (`AuthAndMailSchema.ts:32`) |
| `user_role.user_id` | brak → NO ACTION (`src/users/entities/user-role.entity.ts:28`) | NO ACTION (`AuthAndMailSchema.ts:26`); pierwsza kolumna PK |
| `user_role.granted_by` | zwykły uuid bez relacji (`user-role.entity.ts:25-26`) | brak FK; `grantAdmin` go nie wypełnia (`src/users/grant-admin.ts:28-34`) |
| `subscription.user_id` | CASCADE (`subscription.entity.ts:39`) | CASCADE (`1794406389791-SubscriptionsSchema.ts:26`) |
| `category.user_id` (NULL = domyślna) | CASCADE (`category.entity.ts:38`) | CASCADE (`SubscriptionsSchema.ts:23`) |
| `category_setting.user_id` | CASCADE (`category-setting.entity.ts:28`) | CASCADE (`1794927874576-CategorySetting.ts:14`) |
| `budget_settings.user_id` (PK) | CASCADE (`budget-settings.entity.ts:26`) | CASCADE (`1794948865741-BudgetSettings.ts:14`) |

- FK do `category.id` są `NO ACTION`: `subscription.category_id` (`SubscriptionsSchema.ts:29`) i `category_setting.category_id` (`CategorySetting.ts:17`). Postgres sprawdza `NO ACTION` na końcu instrukcji, więc kaskada z jednego `DELETE FROM "user"` usuwa w tej samej instrukcji subskrypcje, ustawienia i własne kategorie bez błędu — pod warunkiem, że wiersze innego konta nie wskazują na kategorie tego konta. Zapis subskrypcji sprawdza kategorię przez `usableCategory`/`findUsable(userId, …)` (`subscriptions.service.ts:143,165,241`); `PUT /budget` odrzuca cudzą kategorię 400 (`backend-patterns.md:115`). Wniosek (nie test): cudze odwołania nie powinny powstać.
- `user` (`src/users/entities/user.entity.ts:13-39`): `id`, `email` (unique), `is_active`, `email_verified_at`, `consents_accepted_at`, `privacy_policy_version`, `created_at`, relacja `userRoles`.
- `mail` (`src/mail/entities/mail.entity.ts:13-40`): `id`, `type` (`MAGIC_LINK`/`TRIAL_REMINDER`/`OPERATOR_ALERT`), `recipient varchar(254)`, `status`, `error_message`, `created_at`, `sent_at`; bez tematu i treści.

### Sesje, wylogowanie, guard

- `POST /auth/logout` (`src/auth/controllers/auth.controller.ts:79-91`): `@Public()`, 204, `sessions.revoke(token)` + `sessions.clearCookie(response)`.
- `clearCookie` używa tych samych opcji co ustawienie ciasteczka, w tym `Domain` z `SESSION_COOKIE_DOMAIN` w PROD (`session.service.ts:52-58,114-116`).
- Guard `SessionAuthGuard` (globalny `APP_GUARD`, `auth.module.ts:24`) ładuje sesję z użytkownikiem i rolami (`session.service.ts:86-98`); ważna sesja = nieunieważniona, niewygasła i `user.isActive` (`session.service.ts:35-41`). Po twardym usunięciu wiersze sesji znikają, więc każde kolejne żądanie z tym ciasteczkiem dostaje 401.
- `AuthModule` nie ma `exports` (`auth.module.ts`, blok `@Module`), więc `SessionService` nie jest dostępny w `UsersModule` bez zmiany eksportów.
- `UsersModule` (`src/users/users.module.ts:1-12`) nie ma kontrolera; „kim jestem” to `GET /auth/me` (`auth.controller.ts:71-75`).

### Joby a usuwanie

- Job cyklu życia: wszystkie zapisy to warunkowe `UPDATE` (`subscription-lifecycle.service.ts:27-92`); usunięte wiersze dają 0 zmian, bez błędu.
- Przypomnienia o trialu: zaległe tylko dla `is_active` (`trial-reminder.service.ts:59`); rezerwacja `UPDATE … RETURNING` po `user_id` (`:124-136`) — po usunięciu konta zwraca 0 wierszy i użytkownik jest pomijany. Okno ryzyka: usunięcie zatwierdzone po rezerwacji, a przed/w trakcie `sendToUser` (`:148`) → mail wychodzi na usunięty adres, a `saveAudit` dopisuje nowy wiersz `mail` (`mail.service.ts:137-159`). Zwolnienie po błędzie (`:163-169`) trafia w 0 wierszy, bez błędu.
- `register`/`requestLink`: wysyłka po commicie bez `await` (`auth.service.ts:192-205`) — to samo okno dla audytu.

### Frontend

- Trasy (`src/app/app.routes.ts`): `authGuard` na `subscriptions`, `dashboard`, `budget` (`:31-44`); nowa `/account` pasuje po `budget`. W `app.routes.server.ts` potrzebny wpis `RenderMode.Client` przed `'**'` (`:15-41`). `GUARDED_ROUTES` w `e2e/http/render-modes.e2e-spec.ts:10-17` trzeba uzupełnić (CLAUDE.md, Tripwires).
- Nawigacja: `NAV_LINKS` (`layout/app-shell/app-shell.ts:8-12`) z 3 pozycjami; desktop `.shell__account` z e-mailem i „Wyloguj” (`app-shell.html:19-24`), telefon `mat-menu` z e-mailem i „Wyloguj” (`app-shell.html:38-51`). Link do konta może wejść do `NAV_LINKS` albo obok e-maila w obu nawigacjach.
- Wylogowanie (`app-shell.ts:36-49`): `auth.logout()` → `totals.clear()` → `/sign-in`; `AuthService.logout()` ustawia użytkownika na `null` (`auth/auth.service.ts:50-52`). Innej pamięci klienta brak; `/auth/session` wyłączone z transfer cache (`app.config.ts:21-23`). Usunięcie konta potrzebuje tej samej sekwencji — w `AuthService` nie ma dziś metody poza `logout()`, która zeruje użytkownika.
- Interceptor 401 (`auth/session-expired.interceptor.ts:15-31`) działa tylko poza `${apiUrl}/auth/`. Trasa poza `/auth/` + żądanie w locie (np. `CostTotalsStore`) mogą dać 401 i przekierowanie na `/sign-in` ścigające się z własnym przekierowaniem po usunięciu; `totals.clear()` przed nawigacją ogranicza to dla sum.
- Potwierdzenie: `delete-subscription-dialog.ts:29-46,72-95` — `MatDialog`, `role: 'alertdialog'`, fokus na „Anuluj”, dialog sam wysyła żądanie, blokuje się w trakcie, błąd jako `st-notice--error`. Komponent związany z `SubscriptionsService`, więc konto wymaga nowego dialogu wg tego wzoru; pole „wpisz adres” byłoby pierwszym formularzem w dialogu (style `src/styles/_forms.scss`, `shared/form-field-defaults.ts`).
- Polityka prywatności: tylko nagłówek i „w przygotowaniu” (`pages/privacy-policy/privacy-policy.html:2-3`); w sprawdzonych szablonach frontu brak tekstu o usuwaniu konta.

### Testy (gdzie i jak)

- API e2e: `createE2eApp({ addressPrefix })`, `signIn()` przez prawdziwy przepływ (`test/support/e2e-app.ts:120,192-207`), `repository(Entity)` (`:138`), `userIdOf` (`:188`), `sent`/`failMailTo`. Nowa trasa musi wejść do `EXPECTED_ROUTES` (`test/routes.e2e-spec.ts:36-80`) z `access: 'session'`. Wzór CSRF: obcy `Origin` → 403, `CORS_ORIGINS[0]` → przechodzi (`test/app.e2e-spec.ts:90-130`).
- Istniejący test kaskady (`test/subscriptions/subscriptions.e2e-spec.ts:176-197`) ręcznie usuwa sesje/tokeny/role i sprawdza subskrypcje, własne kategorie i zachowanie kategorii domyślnej; nie sprawdza `budget_settings`, `category_setting` ani `mail`.
- Przeglądarka: `createE2eAccounts`, `newAccount()`, `sessionFor()`, ciasteczko przez `context.addCookies` (`frontend-subtracker/e2e/support/accounts.ts:70-154`); dialogi przez `getByRole('alertdialog', { name })` (`test-plan.md` §6.5). `removeTestData` we froncie (`accounts.ts:157-170`) nie usuwa `budget_settings`/`category_setting` jawnie — działa przez kaskadę z `user`.
- `test-plan.md`: ryzyko #1 (IDOR, źródło m.in. „roadmap S-03 i S-10”, `:42`) i #6 (unieważniona sesja daje dostęp, `:47`) dotyczą S-10; brak wpisu cookbooka dla usuwania konta.

## Code References

- `backend-subtracker/src/database/migrations/1793732263880-AuthAndMailSchema.ts:26,32,35` — FK `NO ACTION` od `user`
- `backend-subtracker/src/mail/entities/mail.entity.ts:10-40` — audyt maili, `recipient` bez FK
- `backend-subtracker/src/auth/services/session.service.ts:35-41,100-116` — ważność sesji, `revoke`, `clearCookie`
- `backend-subtracker/src/auth/controllers/auth.controller.ts:71-91` — `/auth/me`, `/auth/logout`
- `backend-subtracker/src/auth/services/auth.service.ts:123-154,192-205` — rejestracja `orIgnore`, wysyłka bez `await`
- `backend-subtracker/src/subscriptions/services/trial-reminder.service.ts:59,124-169` — rezerwacja, wysyłka, zwolnienie
- `backend-subtracker/test/support/e2e-app.ts:158-172` — kolejność usuwania danych konta
- `backend-subtracker/test/subscriptions/subscriptions.e2e-spec.ts:176-197` — test kaskady z S-02
- `frontend-subtracker/src/app/layout/app-shell/app-shell.ts:8-12,36-49` — nawigacja, wylogowanie
- `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/delete-subscription-dialog.ts:29-95` — wzorzec dialogu
- `deploy/mydevil/deploy.sh:23,27,209-217`, `restore-db.sh:32,55-69`, `rollback.sh:67-88` — kopie bazy

## Architecture Insights

- Kolejność w jednej transakcji, zgodna z FK: `session` → `magic_link_token` → `user_role` → `user` (kaskada: `subscription`, `category`, `category_setting`, `budget_settings`) → `mail WHERE recipient = <adres>`. Alternatywa: migracja zmieniająca 3 FK `NO ACTION` na `CASCADE` (zmiana schematu = migracja, lekcja o migracjach); wtedy test kaskady z S-02 i oba sprzątania e2e można uprościć.
- Odpowiedź trasy musi wyczyścić ciasteczko (`clearCookie`, opcje z `Domain`), jak `/auth/logout`.
- Własność trasy: `AuthController` ma już `SessionService` i jest wyłączony z interceptora 401 na froncie (np. `DELETE /auth/account`); `UsersModule` byłby zgodny z podziałem modułów, ale wymaga eksportu `SessionService` z `AuthModule` i nowego kontrolera (np. `DELETE /users/me`). Ścieżka po angielsku (lekcja o trasach).
- „Unieważnienie wszystkich sesji” dzielone z S-09: przy twardym usunięciu sesje po prostu znikają z bazą; dla blokady w S-09 potrzebna będzie osobna funkcja `revoked_at` dla wszystkich sesji użytkownika. Wspólny element to raczej serwis „wszystkie sesje i tokeny konta” niż jeden kod dla obu.
- CSRF: nowa trasa zmieniająca stan dostaje ochronę automatycznie (`backend-patterns.md:57`); wystarczy test z obcym `Origin`.

## Historical Context (from prior changes)

- `context/archive/2026-11-03-magic-link-sign-in/plan.md:46` i `reviews/plan-review.md:84-92` (F6) — usunięcie konta ma objąć `mail`; brak retencji `mail`. Wspierane przez komentarz encji (`mail.entity.ts:10-11`).
- `context/archive/2026-11-03-magic-link-sign-in/plan.md:41` — pełna polityka prywatności przed publicznym startem. Nadal aktualne: strona jest placeholderem.
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:269`, `plan-brief.md:28` — kaskada domenowa „pod przyszłe usuwanie konta”. Wspierane; od tamtej pory kaskadę dostały też `category_setting` i `budget_settings`.
- `roadmap.md:257` („session, magic_link_token i user_role mają NO ACTION”) — wspierane, bez zmian w migracjach.
- `infrastructure.md:86-87` — dzienna kopia MyDevil, przywracanie i usuwanie baz tylko z akceptacją człowieka.

## Related Research

- `context/archive/2026-11-11-first-subscription-in-list/research.md:54,145` — NFR 30 dni w kontekście kaskady.

## Open Questions

Decyzje produktowe do rozstrzygnięcia w `/10x-plan` (właściciel: użytkownik):

1. **Natychmiast czy z karencją?** (`roadmap.md:255`). Natychmiastowe twarde usunięcie jest najprostsze i spełnia NFR od razu; karencja wymaga stanu „do usunięcia”, joba i cofania.
2. **`mail`: usunąć czy zanonimizować** wiersze z adresem (i `error_message`)? Wiersz zapisany przez wysyłkę w locie po usunięciu konta — przyjąć jako ryzyko, czy domykać (np. blokada wiersza `user` jak `lockActiveUser`, `auth.service.ts:157-166`, albo okresowe sprzątanie `mail` bez konta)?
3. **Kopie bazy:** rotacja po liczbie (10 + 10) może trzymać dane dłużej niż 30 dni przy rzadkich deployach, a rollback przywraca konto. Opcje: zapis w polityce prywatności, rotacja po wieku, albo zaakceptowanie i opis. Retencja kopii MyDevil nieznana — do sprawdzenia w panelu.
4. **Potwierdzenie:** wpisanie adresu e-mail czy sam dialog „Usuń konto”? Mail po usunięciu („konto usunięte”) — tak/nie (to nowy wiersz `mail` z adresem).
5. **Trasa i moduł:** `DELETE /auth/account` (AuthController) czy `DELETE /users/me` (nowy kontroler w `users`)? I czy zamieniamy 3 FK na `CASCADE` migracją.
6. **Miejsce w UI:** strona `/account` (link przy e-mailu w obu nawigacjach) czy czwarta pozycja `NAV_LINKS`; dokąd po usunięciu (`/` czy `/sign-in`, z komunikatem).
7. **Ostatni admin:** czy blokować usunięcie konta z rolą `ADMIN` (role nadaje CLI, `backend-patterns.md:32`)?
