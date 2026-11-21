# Usunięcie konta (S-10) — Plan Brief

> Full plan: `context/changes/account-deletion/plan.md`
> Research: `context/changes/account-deletion/research.md`

## What & Why

Użytkownik sam usuwa swoje konto z poziomu aplikacji. Przed usunięciem widzi ostrzeżenie, że jego dane przepadną bezpowrotnie, a po usunięciu jest wylogowany i nic po koncie nie zostaje w danych aplikacji. To slice S-10 roadmapy i realizacja NFR z PRD: dane osobowe i finansowe usunięte w ciągu 30 dni od żądania (tu natychmiast).

## Starting Point

Dane domenowe (subskrypcje, własne kategorie, ustawienia kategorii i budżetu) mają już kaskadę od `user`, ale `session`, `magic_link_token` i `user_role` mają `NO ACTION`. Nie ma kodu usuwania użytkownika ani strony konta. Tabela `mail` trzyma adresy odbiorców bez klucza obcego. Rotacja kopii bazy z deployu liczy pliki, nie ich wiek.

## Desired End State

Na `/account` (adres e-mail w obu nawigacjach jest linkiem) użytkownik otwiera dialog, wpisuje swój adres i usuwa konto. API usuwa je w jednej transakcji, anonimizuje jego wiersze w archiwum `mail` i czyści ciasteczko, a front pokazuje na `/` komunikat „Konto zostało usunięte”. Stare ciasteczko daje 401, ten sam adres może założyć nowe, puste konto, a na adres bez konta nie wychodzi już żaden mail. Kopie bazy na serwerze żyją najwyżej 180 dni.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Moment usunięcia | Natychmiast, bez karencji | Od razu spełnia NFR, bez nowego stanu, joba i cofania. | Plan |
| Potwierdzenie | Wpisanie własnego adresu (dialog + sprawdzenie w API) | Operacja jest nieodwracalna, więc nie wolno jej wykonać jednym odruchowym kliknięciem. | Plan |
| Wiersze `mail` | Zostają jako archiwum, ale z `recipient = 'zanonimizowano@anonymized.invalid'` i `error_message = NULL` | Archiwum wysyłek zostaje, a adres znika. Stały znacznik w formacie adresu przechodzi każde sprawdzenie formatu, a zamazywanie (`j***@gmail.com`) byłoby tylko pseudonimizacją. | Plan |
| Wysyłka w toku | `sendToUser` sprawdza konto przed wysyłką i drugi raz przed zapisem audytu | Żaden mail nie wyjdzie na adres usuniętego konta, a audyt wysyłki przerwanej usunięciem dostaje znacznik. | Plan |
| `CHECK` formatu adresu w kolumnach | Nie teraz | DTO już sprawdzają format, a regex w SQL rozjeżdżałby się z class-validator; znacznik jest z nim zgodny. | Plan |
| Mail „konto usunięte” | Nie wysyłamy | Wystarcza komunikat w aplikacji, a reguła wysyłki jest jedna i bez wyjątków. | Plan |
| Kopie bazy | Usuwane po 180 dniach przez `prune-backups.sh` (z `deploy.sh`, `restore-db.sh` i codziennie z crontaba) + opis w README | Kopia z danymi usuniętego konta nie żyje dłużej niż pół roku, także bez deployów. | Plan |
| Zawsze jakaś kopia | Profilaktyczny `pg_dump`, gdy żaden dump nie jest młodszy niż 30 dni; kasowanie dopiero po jego sukcesie | Po awarii zawsze jest z czego odtworzyć bazę, a kopia nie jest starsza niż miesiąc. | Plan |
| Klucze obce auth | Migracja na `ON DELETE CASCADE` (+ indeks `mail.recipient`) | Usunięcie to jeden `DELETE`, a gwarancja siedzi w schemacie (też dla przyszłego S-09). | Research → Plan |
| Trasa | `POST /auth/delete-account` z `{ email }`, 204 + czyszczenie ciasteczka | Styl `/auth/logout`, bez body w `DELETE`, które proxy obsługują różnie. | Research → Plan |
| UI i przekierowanie | Strona `/account`, po usunięciu `/` z komunikatem | Miejsce na ustawienia konta poza `NAV_LINKS`; nie proponujemy logowania komuś, kto właśnie usunął konto. | Plan |
| Konto admina | Można usunąć | Rolę nadaje CLI, więc operator może ją nadać ponownie. | Plan |

## Scope

**In scope:**
- Migracja kaskady i indeksu, serwis i trasa usuwania z anonimizacją `mail`, sprawdzanie konta przed wysyłką maila
- Strona `/account`, dialog z wpisaniem adresu, link w obu nawigacjach, komunikat na `/`
- Przycinanie kopii bazy starszych niż 180 dni w skryptach serwera i crontabie
- Testy: jednostkowe, e2e API (7 tabel, anonimizacja `mail`, 401/400/403, ponowna rejestracja), e2e przeglądarki
- Dokumentacja: `backend-patterns.md`, README deployu, CLAUDE.md

**Out of scope:**
- Karencja i cofanie usunięcia; mail po usunięciu
- Usuwanie wierszy `mail` i zamazywanie adresu z zachowaniem fragmentów; `CHECK` formatu adresu w kolumnach
- Retencja dziennej kopii MyDevil; pełna polityka prywatności; wspólne „unieważnij wszystkie sesje” z S-09

## Architecture / Approach

Backend: `AccountDeletionService` w module `auth` blokuje wiersz `user` (`FOR UPDATE`, jak `lockActiveUser`) i porównuje znormalizowany adres. Potem anonimizuje wiersze `mail` z tym adresem i usuwa wiersz, a kaskada czyści 7 tabel. Kontroler czyści ciasteczko. `MailService.sendToUser` przed wysyłką i przed zapisem audytu sprawdza w `user`, czy adres ma konto. Serwer: `prune-backups.sh` (z `deploy.sh`, z `restore-db.sh` po przywróceniu i codziennie z crontaba pod blokadą `.ops.lock`) robi profilaktyczny świeży dump, gdy nie ma żadnego młodszego niż 30 dni, i dopiero wtedy usuwa starsze niż 180. Front: `AuthService.deleteAccount` zeruje użytkownika, strona `/account` po sukcesie dialogu czyści sumy i nawiguje na `/` ze stanem `accountDeleted`, z którego `Home` pokazuje komunikat.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend: usuwanie konta | Migracja, `POST /auth/delete-account` z anonimizacją `mail`, reguła wysyłki, testy API | Migracja z różnicami spoza 3 kluczy obcych i indeksu; wyścig z `requestLink` bez blokady wiersza |
| 2. Frontend: `/account` i dialog | Strona, dialog, link, komunikat, trasy, testy jednostkowe | Wyścig 401 z żądaniem w locie przy nawigacji po usunięciu |
| 3. E2E przeglądarki, kopie bazy i dokumentacja | Test Playwright przepływu, `prune-backups.sh` (180 dni, nigdy bez kopii), README, CLAUDE.md | Skasowanie ostatniej kopii albo przywracanego dumpu przy złej kolejności; skrypty i crontab wgrywane ręcznie |

**Prerequisites:** S-02 gotowe (jest); lokalny PostgreSQL z `subtracker-db` i `subtracker-db-dev`, Node 24.
**Estimated effort:** ~3 sesje, po jednej na fazę.

## Open Risks & Assumptions

- Kopie bazy trzymają dane usuniętego konta do 180 dni, czyli dłużej niż NFR „30 dni” (decyzja właściciela; README zapisuje to dla polityki prywatności). Przywrócenie kopii przywraca usunięte konta, a wtedy operator musi ponowić usunięcia.
- Retencji dziennej kopii MyDevil nie kontrolujemy.
- Rollback wydania, którego dump przekroczył 180 dni, jest odmawiany. Do odtworzenia po awarii zawsze zostaje najnowszy dump z `restore-db.sh`.
- Gdy codzienny `pg_dump` w cronie się nie udaje, stare kopie zostają (dłużej niż 180 dni), dopóki ktoś nie zajrzy do logu. Pierwszeństwo ma możliwość odtworzenia bazy, a nie termin przechowywania.
- Wąskie okno: sprawdzenie konta w `sendToUser` przeszło, a potem konto zostało usunięte, zanim SMTP wysłał mail. Wtedy jeden mail wyjdzie, co jest przyjęte. Audyt i tak dostaje znacznik, chyba że usunięcie wypadnie dokładnie między drugim sprawdzeniem a zapisem.

## Success Criteria (Summary)

- Użytkownik usuwa konto w kilku krokach i nie zrobi tego przypadkiem.
- Po usunięciu jego dane i adres nie istnieją w żadnej tabeli aplikacji (archiwum `mail` ma znacznik), a stare ciasteczko nic nie otwiera.
- Na adres usuniętego konta nie wychodzi żaden mail.
