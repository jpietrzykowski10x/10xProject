---
date: 2026-11-21T12:26:03+01:00
researcher: Claude (Opus 5.5) dla Jakub Pietrzykowski
git_commit: 07a98501e9b1dd80466886f7bdafdfd90c46b5ad
branch: change/admin-account-management
repository: 10xProject (SubTracker)
topic: "S-09 admin-account-management — na czym slice buduje: role, blokada konta, sesje, wgląd admina, testy"
tags: [research, backend, frontend, auth, roles, is_active, sessions, admin, S-09]
status: complete
last_updated: 2026-11-21
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Follow-up 2026-11-21: decyzje użytkownika zamykają Open Questions 1-7"
---

# Research: S-09 admin-account-management

**Date**: 2026-11-21T12:26:03+01:00
**Researcher**: Claude (Opus 5.5) dla Jakub Pietrzykowski
**Git Commit**: 07a98501e9b1dd80466886f7bdafdfd90c46b5ad
**Branch**: change/admin-account-management
**Repository**: 10xProject (SubTracker)

## Research Question

`change.md` nie ma notatek, więc pytanie wynika z roadmapy (`context/foundation/roadmap.md:233-244`) i PRD (FR-002, `prd.md:62`, Access Control `prd.md:121-123`): administrator (rola nadana ręcznie poza aplikacją) odblokowuje konto lub resetuje dostęp i ma wgląd w dane użytkownika, w tym subskrypcje i kwoty. Badanie ustala:

1. co już istnieje w kodzie (role, guardy, `is_active`, sesje, CLI, serwisy danych, frontend, testy);
2. jakie decyzje i odroczenia na S-09 zapisano wcześniej (foundation, archiwum);
3. co pozostaje otwartą decyzją produktową przed `/10x-plan`.

## Summary

- **Mechanizm ról jest gotowy, ale nieużyty.** Encje `role`/`user_role`, enum `RoleCode { USER, ADMIN }`, globalny `RolesGuard` (403 przy braku roli) i dekorator `@Roles()` istnieją. W sprawdzonych kontrolerach `@Roles` nie występuje; jest tylko w teście jednostkowym guarda (`backend-subtracker/src/shared/guards/roles.guard.spec.ts:11-22`). Tras `/admin` nie ma ani w backendzie, ani we frontendzie.
- **`user.is_active` to już flaga blokady, ale nic go nie ustawia na `false`.** Kolumnę czytają cztery sprawdzone miejsca: ważność sesji, `lockActiveUser` (register/request-link), `verify` i job przypomnień o trialu. W `src/` nic nie zapisuje `false`; robią to wyłącznie testy, przez repozytorium.
- **Dzisiejsza blokada jest „miękka”.** `is_active = false` tylko sprawia, że sesje są nieważne. Nie unieważnia ich i nie usuwa niezużytych linków, więc po odblokowaniu niewygasłe sesje i link znów działają. Archiwum S-01 przypisuje S-09 dwa zadania: dezaktywacja w jednej transakcji (flaga + usunięcie tokenów + unieważnienie sesji) oraz ujednolicenie kolejności blokad w `verify`. S-10 przekazuje S-09 zaprojektowanie funkcji „unieważnij wszystkie sesje”.
- **Dane do wglądu admina są już parametryzowane `userId`.** `SubscriptionsService.list/totals`, `BudgetService.get/budgetSettings` i `CategoriesService.list` przyjmują `userId` jako pierwszy argument. `SubscriptionsModule` nie ma jednak `exports`, więc inny moduł nie wstrzyknie tych serwisów bez zmiany modułu.
- **Frontend:** `AuthUser` niesie `roles`, ale nic nie sprawdza ról. Nawigacja to stała tablica `NAV_LINKS`. `SubscriptionTable` jest sterowana wejściami, tyle że zawsze pokazuje przyciski akcji. `CostTotals` i `Dashboard` są związane ze sklepem bieżącego użytkownika. Odpowiedzi 403 nic nie obsługuje.
- **Testy:** lista tras (`test/routes.e2e-spec.ts`) zna tylko dostęp `public` i `session`, więc trasa z `@Roles(ADMIN)` wymaga nowej kategorii dostępu i sprawdzenia 403. Admina w e2e tworzy się przez `grantAdmin(e2e.dataSource, address)` po `signIn()`.
- **Otwarte decyzje produktowe** (pytanie z roadmapy `roadmap.md:242`, wciąż bez odpowiedzi): co znaczy „zablokowane konto” i „reset dostępu” przy logowaniu tylko magic linkiem. Do tego: kto blokuje (UI admina czy tylko odblokowanie), czy zablokowany coś zobaczy, audyt akcji admina, admin wobec admina i zakres widoku danych.

## Detailed Findings

### 1. Role i dostęp (backend)

- Encja `role`: `id`, unikalne `code: RoleCode`, `name`, `is_active` (domyślnie `true`). Liczą się tylko role aktywne (`backend-subtracker/src/users/entities/role.entity.ts:4-18`).
- `user_role`: jawna encja łącząca z PK (`user_id`, `role_id`), `granted_at` i nullable `granted_by`; FK do `user` z `onDelete: 'CASCADE'` (`src/users/entities/user-role.entity.ts:14-35`). W sprawdzonym kodzie nic nie ustawia `granted_by`; `grantAdmin` go nie wypełnia (`src/users/grant-admin.ts:9-35`).
- `RoleCode` i `ROLE_DEFINITIONS` ze stałymi UUID: `src/shared/types/role-code.ts:1-19`. Seed robi migracja `src/database/migrations/1793732271790-SeedRoles.ts:9-13`, a w bazie dev `RolesSeeder` (`src/users/services/roles-seeder.ts:21-32`, tylko przy `synchronize`).
- Role trafiają do `request.user`: `SessionService.authenticate` ładuje `session → user → userRoles → role` (`src/auth/services/session.service.ts:86-98`), a `toAuthUser` zostawia role z `role.isActive` (`:25-33`). `AuthUser = { id, email, roles: RoleCode[] }` (`src/shared/types/auth-user.ts:4-13`). Role są czytane przy każdym żądaniu, więc nadanie roli działa od następnego żądania tej samej sesji (`test/auth/sign-in.e2e-spec.ts:189-199`).
- `RolesGuard` (`src/shared/guards/roles.guard.ts:14-33`): metadane `@Roles` przez `getAllAndOverride` (metoda, potem klasa), bez metadanych przepuszcza, przy braku roli `ForbiddenException` (403), bez zapytań do bazy. Oba guardy są globalne, w kolejności Session → Roles (`src/auth/auth.module.ts:25-27`).
- Ustalona reguła: dostęp admina do cudzych danych idzie tylko przez osobne kontrolery `/admin/...` z `@Roles(RoleCode.ADMIN)`; izolacja kont zostaje w serwisach (`context/foundation/backend-patterns.md`, sekcja „Dostęp: bezpiecznie domyślnie”, punkt „Izolacja kont nie jest zadaniem guarda”). Operacje serwisowe (nadanie roli) robi skrypt CLI, nie endpoint (ta sama sekcja, punkt „Bez sekretów w nagłówkach”).

### 2. `user.is_active` — gdzie i jak działa dziś

- Definicja: `src/users/entities/user.entity.ts:22-23` (`boolean`, domyślnie `true`), z migracji `1793732263880-AuthAndMailSchema.ts:14`.
- Odczyty (4 miejsca znalezione grepem w `src/`):
  - `isValid` w `session.service.ts:35-41`: `revokedAt === null`, `expiresAt > now` i `session.user.isActive`. Działa dla globalnego guarda i dla `GET /auth/session`, który wtedy zwraca `{ user: null }`.
  - `lockActiveUser` w `src/auth/services/auth.service.ts:157-166`: `SELECT … FOR UPDATE` po adresie, `null` dla nieaktywnego konta. Używają go `register` (`:51`) i `requestLink` (`:74`).
  - `verify` w `auth.service.ts:100-106`: `if (user === null || !user.isActive) throw new UnauthorizedException()`.
  - `whereDue` przypomnień o trialu: `src/subscriptions/services/trial-reminder.service.ts:58-60`, warunek `EXISTS (… "owner"."is_active" = true)`.
- Nie sprawdzają `is_active`: job cyklu życia (`subscription-lifecycle.service.ts:27-52`, przesuwa daty także zablokowanym kontom) i `MailService.sendToUser`, który sprawdza tylko istnienie konta (`src/mail/services/mail.service.ts:71-91, 144-153`).
- Zapis `false`: brak w `src/`. Robią to tylko testy: `test/auth/token-rules.e2e-spec.ts:107`, `test/auth/privacy-validation.e2e-spec.ts:61`, `test/subscriptions/trial-reminder.e2e-spec.ts:119-122` oraz specy jednostkowe `session-auth.guard.spec.ts:145` i `auth.service.spec.ts:140,275,303`. Wzór w cookbooku: `repository(User).update(..., { isActive: false })` (`context/foundation/test-plan.md:165`).
- Co widzi zablokowany użytkownik dziś (ścieżki sprawdzone przez agenta backendu):
  - `POST /auth/register` i `POST /auth/request-link`: 202 bez treści, tak samo jak dla aktywnego i nieznanego adresu; brak tokenu i maila (`auth.controller.ts:32-46`; test `privacy-validation.e2e-spec.ts:55-71`).
  - `POST /auth/verify` z linkiem sprzed blokady: 401, a rollback transakcji zostawia token niezużyty (`token-rules.e2e-spec.ts:103-115`).
  - Istniejąca sesja: 401 na trasach chronionych (`session-auth.guard.ts:31-33`). We frontendzie interceptor zamienia to na przekierowanie do `/sign-in` (`frontend-subtracker/src/app/auth/session-expired.interceptor.ts:15-31`).
- Ponowna rejestracja zablokowanego adresu nie zakłada nowego konta: insert z `orIgnore` po unikalnym adresie, potem `lockActiveUser` zwraca `null` (`context/archive/2026-11-20-account-deletion/research.md:31`). Przy blokadzie adres pozostaje zajęty.

### 3. Sesje i linki — unieważnianie

- `session.revoked_at` (z indeksem): `src/auth/entities/session.entity.ts:41-43`. Ustawia go tylko `SessionService.revoke(token)` (`session.service.ts:100-105`), wołane wyłącznie z `logout` (`auth.controller.ts:82-94`). W sprawdzonym kodzie nie ma funkcji unieważniającej wszystkie sesje konta.
- Nowy link usuwa niezużyte tokeny konta (`tokens.delete({ userId, usedAt: IsNull() })`, `auth.service.ts:174`), pod blokadą wiersza z `lockActiveUser`.
- `verify` zużywa token atomowym `UPDATE … RETURNING user_id` (`auth.service.ts:84-93`), a potem czyta użytkownika bez blokady wiersza (`:100-106`). Kolejność blokad jest więc token → użytkownik, a przy wystawianiu linku użytkownik → token.
- Sprzątanie usuwa sesje wygasłe lub unieważnione ponad 7 dni temu (`src/auth/services/auth-cleanup.service.ts:25-35`, `auth.constants.ts:12`).
- Wzór transakcji z blokadą: `AccountDeletionService.delete` (`src/auth/services/account-deletion.service.ts:18-45`): `pessimistic_write` na wierszu `user` (ta sama blokada co `lockActiveUser`), potem zmiany.
- Indeksy `user_id` w `session` i `magic_link_token` już są (migracja `AddAuthUserIdIndexes`; `context/archive/2026-11-03-magic-link-sign-in/reviews/impl-review-phase-3.md:86`). Dodano je z myślą o „wyloguj wszędzie” z S-09.
- `AuthModule` nie eksportuje `SessionService` (`context/archive/2026-11-20-account-deletion/research.md:59-61`; nie sprawdzano ponownie).

### 4. CLI

- `npm run admin:grant -- <mail>` (`package.json`: `nest build && node dist/cli/admin-grant.js`). Wejście `src/cli/admin-grant.ts:1-42`: bez startu Nest, `process.loadEnvFile`, własny `DataSource` z `entities: [User, Role, UserRole]`, kod wyjścia 1 przy błędzie. Logika w `src/users/grant-admin.ts:9-35`: idempotentna (`orIgnore`), nieznany adres rzuca błąd.
- Na serwerze uruchamia się `cli/admin-grant.js` z katalogu `public_nodejs` (`deploy/mydevil/README.md:136-142` PL, `:333-342` EN).
- Innych skryptów CLI nie ma: ani odebrania roli, ani blokady i odblokowania.

### 5. Użytkownik i dane do wglądu

- Pola `User` (`src/users/entities/user.entity.ts`): `id`, `email` (unikalny, po `normalizeEmail`), `isActive`, `emailVerifiedAt`, `consentsAcceptedAt`, `privacyPolicyVersion`, `createdAt`, `userRoles`. Nie ma `updated_at`, `blocked_at`, `blocked_by` ani powodu blokady.
- `UsersModule` (`src/users/users.module.ts:8-12`) ma tylko `RolesSeeder`: bez kontrolera, bez serwisu użytkowników, bez `exports`.
- Serwisy z `userId` jako pierwszym argumentem:
  - `SubscriptionsService.list(userId, sort)` (`src/subscriptions/services/subscriptions.service.ts:99-112`)
  - `SubscriptionsService.totals(userId)` (`:117`)
  - `BudgetService.budgetSettings(userId)` (`src/subscriptions/services/budget.service.ts:50`) i `get(userId)` (`:82`)
  - `CategoriesService.list(userId)` (`src/subscriptions/services/categories.service.ts:36`)
- Komentarz klasy mówi, że `userId` nigdy nie pochodzi z body (`subscriptions.service.ts:89`). `SubscriptionsModule` nie ma `exports` (`src/subscriptions/subscriptions.module.ts:20-46`).
- Typy odpowiedzi nie zawierają `userId` (`backend-patterns.md`, „Dane domenowe”, punkt „Odpowiedzi”), a `GET` z danymi użytkownika ma `Cache-Control: no-store`.

### 6. Maile

- `MailType { MAGIC_LINK, TRIAL_REMINDER, OPERATOR_ALERT }` (`src/mail/mail.types.ts:1-5`); kolumna `mail.type` to `varchar(30)`, więc nowy typ nie wymaga migracji enumu (`src/mail/entities/mail.entity.ts:20-21`). Szablonów ani typów dla blokady i odblokowania nie ma.
- `sendToUser` nigdy nie odrzuca i pomija adresy bez konta; `notifyOperator` idzie na `NOTIFICATION_ADMINISTRATOR_MAIL` (`mail.service.ts:71,93`).

### 7. Frontend

- Trasy (`frontend-subtracker/src/app/app.routes.ts:5-55`): `''`, `register`, `sign-in` (`guestGuard`), `privacy-policy`, `auth/verify`, `subscriptions`, `dashboard`, `budget`, `account` (`authGuard`), `unavailable`. W `app.routes.server.ts:8-46` strony z `authGuard` mają `RenderMode.Client`, a `'**'` to `Prerender`. Nowa trasa admina potrzebuje wpisu `Client`, inaczej zostanie prerenderowana (ostrzeżenie w `auth.guard.ts:57-60`).
- `AuthUser = { id, email, roles: string[] }` (`src/app/auth/auth.service.ts:6-10`). `authGuard` i `guestGuard` (`auth.guard.ts:94-137`) nie patrzą na role; w `src/app` nie ma guarda ról. Fikstury testów używają różnej wielkości liter: `['user']` (`auth.guard.spec.ts:36`) i `['USER']` (`app-shell.spec.ts:88`). Backend zwraca `RoleCode`, czyli `'USER'`/`'ADMIN'`.
- Nawigacja: `NAV_LINKS` w `src/app/layout/app-shell/app-shell.ts:8-12`, renderowana w dwóch miejscach: kolumna na desktopie (`app-shell.html:5-15`) i `mat-menu` na telefonie (`:46-56`). App-shell nie jest layoutem trasy: każda strona owija się w `<app-shell>`, a `ngOnInit` shella woła `CostTotalsStore.load()` (`app-shell.ts:32-34`). Strona admina w shellu ładowałaby więc sumy samego admina.
- `SubscriptionTable` (`src/app/pages/subscriptions/subscription-table/subscription-table.ts:49-62`) to komponent prezentacyjny (`input.required<Subscription[]>`). Przyciski akcji renderuje zawsze, bez wejścia „tylko do odczytu”. `CostTotals` (`src/app/subscriptions/cost-totals/cost-totals.ts:34-38`) i `Dashboard` (`src/app/pages/dashboard/dashboard.ts:32-66`) czytają `CostTotalsStore`, czyli `/subscriptions/totals` bieżącego konta. Funkcje pomocnicze (`subscription-labels.ts`, `monthlyAmount`) przyjmują dane argumentami.
- Interceptor reaguje tylko na 401 spoza `/auth/` (`session-expired.interceptor.ts:18-24`). W kodzie innym niż specy nic nie obsługuje 403 (grep `403` w `src/app`).

### 8. Testy i bramki

- Backend: `test/routes.e2e-spec.ts`. `EXPECTED_ROUTES` (`:346-391`, 20 tras) ma typ `Access = 'public' | 'session'` (`:324`). Testy sprawdzają: dokładnie te trasy z tym dostępem (`:494-502`), test dwóch kont dla każdej trasy z parametrem (`:504-519`) i 401 bez ciasteczka dla tras `session` (`:521-541`). Kategorii `admin` i sprawdzenia 403 nie ma.
- Cookbook §6.4 (`context/foundation/test-plan.md:150-158`) każe dopisać każdą nową trasę do `EXPECTED_ROUTES` i do ręcznej listy w `test/subscriptions/access.e2e-spec.ts`. Opisuje tylko dostęp `session`/`public`.
- Helper e2e (`test/support/e2e-app.ts`): `signIn()`, `twoAccounts()`, `repository()`, `userIdOf()`; helpera admina nie ma. Admina robi się przez `grantAdmin(e2e.dataSource, address)` (`test/auth/sign-in.e2e-spec.ts:189-199`). Komentarz `e2e-app.ts:155-157` mówi jeszcze o „ON DELETE NO ACTION”; od S-10 to nieaktualne.
- Frontend: `e2e/http/render-modes.e2e-spec.ts` `GUARDED_ROUTES` (`:10-18`); trasa z `authGuard` musi tam trafić (CLAUDE.md). Wzór testu jednostkowego guarda: `src/app/auth/auth.guard.spec.ts` (fałszywa tylko granica HTTP, `describe.each(['server','browser'])`).
- Ryzyka z test-planu dotyczące S-09: #1 IDOR, którego źródłem jest m.in. wyjątek od izolacji dla admina (`test-plan.md:42`); #6 unieważniona lub wygasła sesja nadal daje dostęp (`:47`); #7 nowe ekrany i formularze (`:48`). Wymagane bramki z §5 (`:98-106`) obejmują S-09 bez specjalnych wpisów.

## Code References

- `backend-subtracker/src/shared/guards/roles.guard.ts:14-33` — globalny guard ról, 403
- `backend-subtracker/src/shared/decorators/roles.decorator.ts:4-13` — `@Roles()`
- `backend-subtracker/src/auth/auth.module.ts:25-27` — kolejność APP_GUARD
- `backend-subtracker/src/auth/services/session.service.ts:25-41,86-105` — `toAuthUser`, `isValid`, `authenticate`, `revoke`
- `backend-subtracker/src/auth/services/auth.service.ts:84-106,145-187` — `verify`, nadanie roli USER, `lockActiveUser`, `issueLink`
- `backend-subtracker/src/auth/services/account-deletion.service.ts:18-45` — wzór transakcji z blokadą wiersza `user`
- `backend-subtracker/src/users/entities/user.entity.ts:15-38` — pola `User`
- `backend-subtracker/src/users/grant-admin.ts:9-35`, `src/cli/admin-grant.ts:1-42` — CLI nadania roli
- `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:99-117` — `list`, `totals` po `userId`
- `backend-subtracker/src/subscriptions/subscriptions.module.ts:20-46` — brak `exports`
- `backend-subtracker/src/subscriptions/services/trial-reminder.service.ts:58-60` — job pomija zablokowanych
- `backend-subtracker/src/mail/mail.types.ts:1-17` — typy maili
- `backend-subtracker/test/routes.e2e-spec.ts:324,346-541` — lista tras i jej testy
- `frontend-subtracker/src/app/auth/auth.service.ts:6-10` — `AuthUser.roles`
- `frontend-subtracker/src/app/layout/app-shell/app-shell.ts:8-34` — `NAV_LINKS`, ładowanie sum
- `frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.ts:49-62` — tabela sterowana wejściami
- `frontend-subtracker/src/app/auth/session-expired.interceptor.ts:15-31` — tylko 401

## Architecture Insights

- Wyjątek od izolacji kont ma jedno ustalone miejsce: kontrolery `/admin/...` z `@Roles(ADMIN)`, które wołają serwisy domeny z `userId` wskazanego użytkownika. Zwykłe kontrolery dalej biorą `userId` tylko z `@CurrentUser()`. Ryzyko z roadmapy („wyjątek przecieknie do zwykłych użytkowników”, `roadmap.md:243`) dotyczy więc dwóch rzeczy: czy każda trasa admina ma `@Roles`, i czy żaden zwykły kontroler nie przyjmuje `userId` z zewnątrz. Pierwsze da się sprawdzić automatycznie, rozszerzając listę tras o dostęp `admin`.
- Blokada to dziś stan (`is_active`) sprawdzany przy odczycie. Brakuje akcji, która ten stan ustawi i przy okazji posprząta: usunie tokeny i unieważni sesje. W archiwum ustalono, że taka akcja ma być jedną transakcją z blokadą wiersza `user`, jak przy usuwaniu konta.
- Operacje operatora idą przez CLI z własnym `DataSource` i funkcją przyjmującą `DataSource`, którą e2e woła bezpośrednio (`grantAdmin`). To gotowy wzór, gdyby jakaś akcja (np. odebranie roli) miała zostać poza UI.

## Historical Context (from prior changes)

- `context/archive/2026-11-03-magic-link-sign-in/plan.md:44` — panele i trasy `/admin/...` odłożone do S-09; S-01 tworzy tylko `admin:grant`. **Obowiązuje.**
- `context/archive/2026-11-03-magic-link-sign-in/plan.md:437` — follow-up „S-09: ujednolicić kolejność blokad w `verify`” z przepisem: odczyt `user_id` po hashu, blokada użytkownika osobnym zapytaniem, atomowy `UPDATE` tokenu, odczyt ról. Powód: dziś `is_active` jest czytane bez blokady, więc `verify` mogłoby utworzyć sesję tuż po dezaktywacji. Decyzja: `reviews/impl-review-phase-3.md:67-78`. **Nadal otwarte:** kod `verify` ma starą kolejność (`auth.service.ts:84-106`).
- `context/archive/2026-11-03-magic-link-sign-in/plan.md:445` — follow-up „S-09: dezaktywacja konta”: jedna transakcja ustawia `is_active = false`, usuwa niezużyte tokeny i unieważnia sesje; do rozważenia „wyloguj wszędzie”. **Nadal otwarte:** w `src/` nie ma takiego kodu.
- `context/archive/2026-11-20-account-deletion/plan.md:45` — S-10 nie zbudowało wspólnej funkcji „unieważnij wszystkie sesje”, bo blokada w S-09 „zaprojektuje własną”. `research.md:104` tej zmiany sugeruje serwis „wszystkie sesje i tokeny konta” zamiast jednego kodu dla obu.
- `context/archive/2026-11-20-account-deletion/plan.md:44` — usunięcie konta z rolą ADMIN jest dozwolone, bo rolę da się nadać ponownie przez CLI.
- `context/archive/2026-11-20-account-deletion/research.md:31` — `is_active` to mechanizm blokady z S-09, nie miękkie usunięcie. **Obowiązuje.**
- `context/archive/2026-11-13-backend-e2e-account-isolation/plan.md:280` — testy auth podzielono na pliki tematyczne m.in. dlatego, że „S-09 dołoży dezaktywację konta”.
- `backend-patterns.md`, sekcja „Sesja zamiast JWT”: „Wylogowanie i blokada konta (S-09) ustawiają `revoked_at`”. **Decyzja zapisana z góry na S-09.**
- `backend-patterns.md`, „Przypomnienia o trialu (S-06)”, zdanie wstępne: wzorzec joba z mailem także „dla kolejnych jobów z mailem (FR-015, S-09)”. Jaki job z mailem ma mieć S-09, nigdzie nie zapisano.

Niespójności w dokumentach foundation (do poprawienia przy okazji, nie blokują):

- `roadmap.md:67` (Stream D) i `:258` (ryzyko S-10) mówią o wspólnym unieważnianiu sesji i dezaktywacji z S-09. S-10 świadomie tego nie zrobiło (`account-deletion/plan.md:45`).
- `roadmap.md:281`, otwarte pytanie #1 (usunięcie danych ręcznie przez admina czy samoobsługowo), nie zostało zamknięte, choć S-10 dostarczyło usuwanie samoobsługowe (`roadmap.md:56,317`).
- `roadmap.md:275`: przekazanie S-09 nadal ma „Czeka na S-02”, „Ready: no”, choć S-02 jest `done` (`roadmap.md:47`).

## Related Research

- `context/archive/2026-11-20-account-deletion/research.md` — sesje, kaskady i `is_active` jako blokada (stan na 2026-11-20)
- `context/archive/2026-11-11-first-subscription-in-list/research.md:53` — reguła `/admin/...` z `@Roles` (kotwica do `backend-patterns.md` się przesunęła)

## Open Questions

Decyzje produktowe dla użytkownika przed `/10x-plan` (żaden dokument ich nie rozstrzyga):

1. **„Zablokowane konto”** — co je blokuje i kto? Dziś nic nie ustawia `is_active = false`. Czy admin ma w UI blokować i odblokowywać, czy tylko odblokowywać (a blokuje np. operator)? Czy blokada natychmiast unieważnia sesje i linki (`backend-patterns.md` mówi „tak, `revoked_at`”)?
2. **„Reset dostępu”** przy logowaniu tylko magic linkiem — możliwe znaczenia z dokumentów: „wyloguj wszędzie” (unieważnij sesje i linki), wysłanie nowego linku przez admina albo zmiana adresu e-mail konta (gdy użytkownik stracił skrzynkę). Która ścieżka to „zawiodły standardowe opcje odzyskiwania” (`prd.md:123`)? Zmiana adresu dotyka unikalności `email` i maili z linkiem.
3. **Czy zablokowany użytkownik dostaje informację** (komunikat przy logowaniu, mail o blokadzie albo odblokowaniu)? Dziś `register` i `request-link` odpowiadają mu 202 jak każdemu (anty-enumeracja) i nic nie wysyłają.
4. **Wgląd admina** — co dokładnie widać: lista kont (z wyszukiwaniem po adresie?), subskrypcje, sumy i alerty, ustawienia budżetu? Tylko odczyt, bez edycji danych użytkownika? PRD zakłada pełny wgląd na MVP (`prd.md:123`).
5. **Audyt akcji admina** — kto i kiedy zablokował lub odblokował. Brak kolumn i tabeli; `granted_by` istnieje, ale jest puste.
6. **Admin wobec admina i siebie** — czy można zablokować innego admina albo siebie? Czy potrzebne jest CLI odebrania roli?
7. **Skutki uboczne blokady** — czy `sendToUser` i job cyklu życia mają pomijać zablokowane konta (dziś pomija je tylko job przypomnień)?

Kwestie techniczne do rozstrzygnięcia w planie (nie wymagają decyzji produktowej): kolejność blokad w `verify` (follow-up S-01), eksport serwisów z `SubscriptionsModule` albo osobny moduł admina, kategoria `admin` w `EXPECTED_ROUTES` z testem 403 dla sesji bez roli, obsługa 403 i trasa `Client` we frontendzie, strona admina bez ładowania własnych sum admina w shellu.

## Follow-up 2026-11-21: decyzje użytkownika

Odpowiedzi na Open Questions 1–7 (rozmowa 2026-11-21) i na cztery pytania doprecyzowujące z ponownej analizy. Zastępują one sekcję Open Questions wyżej. Pozycje „Kwestie techniczne” z tamtej sekcji zostają dla planu.

| # | Pytanie | Decyzja |
| --- | --- | --- |
| 1 | Zablokowane konto | `user.is_active = false`. Admin może **blokować i odblokowywać**. Mechanizm posłuży też później: blokada po kilku nieudanych próbach logowania hasłem (FR-003, Parked) i przycisk „to nie ja” w powiadomieniu o logowaniu z nowego urządzenia (zaufane urządzenia, Parked). Oba poza zakresem S-09. |
| 2 | Reset dostępu | **„Wyloguj wszędzie”**: unieważnia wszystkie sesje (`revoked_at`) i niewykorzystane linki konta, a konto zostaje aktywne. Nie robimy wysyłki linku przez admina ani zmiany adresu e-mail. |
| 3 | Informacja dla zablokowanego | **Mail i komunikat.** Mail w chwili blokady oraz przy prośbie o link (zamiast linku). Dodatkowo komunikat „konto zablokowane” przy próbie logowania. To świadomy wyjątek od jednakowej odpowiedzi 202 z S-01 (`backend-patterns.md`, „Sesja zamiast JWT”). Uzasadnienie użytkownika: zablokowany musi wiedzieć, że nie może się zalogować, a z zewnątrz trzeba najpierw znać adres; ujawnia się tylko to, że adres jest zablokowany. Odpowiedzi dla adresu aktywnego i nieznanego zostają jednakowe. Odblokowanie: na MVP kontakt z adminem (użytkownik zostawił to „do rozważenia”; samoobsługowa ścieżka ma sens dopiero przy blokadzie po hasłach, FR-003). Skąd brać adres kontaktowy w komunikacie, ustali plan (bez prawdziwej domeny w repo). |
| 4 | Wgląd admina | Admin **widzi wszystko** (subskrypcje, kwoty, sumy, alerty, ustawienia budżetu) i zarządza aktywnością konta. Na tym etapie **nie edytuje danych użytkownika**. |
| 5 | Audyt | **Tak, zmiany i podglądy:** blokada, odblokowanie, reset oraz każde otwarcie danych konkretnego użytkownika (kto, komu, co, kiedy). Brak powodu jako pola obowiązkowego. Dziś nie ma takiej tabeli; `user_role.granted_by` jest puste. |
| 6 | Admin wobec admina i siebie | Nikt **nie blokuje samego siebie**. Nowa rola **SUPERADMIN**: jedna osoba, „może wszystko”, w tym blokować innego admina. Zwykły ADMIN zarządza tylko użytkownikami bez ról administracyjnych. Role ADMIN i SUPERADMIN nadaje i odbiera **wyłącznie skrypt CLI** (dochodzi odebranie roli i nadanie SUPERADMIN), bez API do zarządzania rolami. W UI superadmin tylko blokuje i odblokowuje adminów. Rola SUPERADMIN ma nie być widoczna przez API. |
| 7 | Skutki uboczne blokady | Joby i maile **pomijają zablokowane konta**. Merytoryczne wyjątki wychodzą normalnie, np. mail o zablokowaniu. Dziś pomija je tylko job przypomnień (`trial-reminder.service.ts:58-60`); `sendToUser` i job cyklu życia nie. Job cyklu życia nadrabia zaległe przejścia przy pierwszym przebiegu po odblokowaniu (lekcja „Zadania cykliczne nadrabiają pominięte uruchomienia”). |

Skutki dla planu, wynikające z decyzji (do rozpisania w `/10x-plan`):

- Nowy `RoleCode.SUPER_ADMIN`: wpis w `ROLE_DEFINITIONS` ze stałym UUID, migracja danych i `RolesSeeder`. Jedna osoba to reguła operacyjna skryptu; czy wymusza ją baza, ustali plan. „Niewidoczna w API” trzeba pogodzić z tym, że `AuthUser.roles` trafia do frontendu przez `GET /auth/session` (`session.service.ts:25-33`). Plan wybiera: ukryć kod roli w odpowiedzi czy pokazywać go tylko samemu superadminowi.
- Blokada i reset jako jedna transakcja z blokadą wiersza `user` (wzór `AccountDeletionService`), razem z poprawką kolejności blokad w `verify` (follow-up S-01, `magic-link-sign-in/plan.md:437`).
- Zmiana kontraktu `request-link`, `register` i `verify` dla zablokowanego adresu (komunikat plus mail), z testami, że adres aktywny i nieznany nadal dostają identyczne odpowiedzi.
- `MailService.sendToUser` pomija konta z `is_active = false`, z wyjątkiem typów maili o blokadzie. Job cyklu życia pomija zablokowane konta.
- Nowa tabela audytu z `user_id` admina i celu (kaskada od użytkownika? anonimizacja przy usunięciu konta, jak archiwum `mail`?) to decyzja planu zgodna z regułą kaskady z `backend-patterns.md`. Audyt podglądu oznacza zapis także przy żądaniach `GET`.
- Lista tras: nowa kategoria dostępu `admin` w `EXPECTED_ROUTES` z testem 403 dla sesji bez roli.

Poza roadmapą: PRD (`prd.md:121-123`, Access Control) zna tylko role User i Admin. SUPERADMIN i wyjątek od jednakowej odpowiedzi przy logowaniu to zmiany Access Control, których PRD jeszcze nie odzwierciedla.
