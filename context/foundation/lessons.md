# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Unikaj typu `any`

- **Context**: Oba projekty — `frontend-subtracker/` i `backend-subtracker/`
- **Problem**: Przy `any` TypeScript gubi kontekst typów i ma problem z podpowiedziami.
- **Rule**: Unikaj typu `any`.
- **Applies to**: plan, implement

## Schemat bazy zmieniają tylko migracje generowane na koniec funkcji

- **Context**: `backend-subtracker/` — TypeORM, lokalnie `subtracker-db-dev` (z `synchronize`) i referencyjna `subtracker-db`; na MyDevil jedna baza
- **Problem**: `synchronize` na bazie dev nie zostawia śladu w repo. Bez migracji wygenerowanej względem bazy referencyjnej zmiana encji nie trafi na produkcję albo trafi tam niekompletna. `migration:revert` (metody `down()`) bywa zawodny i zostawia bazę do ręcznego sprzątania.
- **Rule**:
  - Każdy slice zmieniający encje kończy się krokiem `npm run migration:generate -- <Nazwa>` (porównanie z `subtracker-db`). Potem: przegląd pliku, `npm run migration:run` na `subtracker-db`, commit migracji razem z kodem. Dane startowe idą osobną migracją.
  - Nigdy nie włączać `synchronize` ani `migrationsRun` poza `MODE=DEV`. Nie kierować CLI migracji na bazę `-dev`.
  - Na produkcji migracje wchodzą tylko w `deploy.sh`, w oknie przestoju i po `pg_dump`.
  - Na produkcji nie używać `migration:revert`. Cofnięcie bazy to `restore-db.sh` z kopii.
- **Applies to**: plan, implement

## Zadania cykliczne nadrabiają pominięte uruchomienia

- **Context**: `backend-subtracker/` — `@nestjs/schedule` (przypomnienia o trialach i inne joby)
- **Problem**: Deploy API zatrzymuje proces na ok. 30–60 s, a MyDevil może zrestartować proces w dowolnej chwili. Job, który zakłada start o konkretnej minucie, po prostu pominie okno.
- **Rule**: Joby mają być idempotentne i przetwarzać wszystko, co zaległe, np. „wyślij przypomnienia, których termin minął i nie zostały wysłane”, z trwałym znacznikiem wykonania w bazie. Nie zakładamy, że poprzednie uruchomienie się odbyło.
- **Applies to**: plan, implement

## Relacje encji w ESM owijamy w `Relation<T>`

- **Context**: `backend-subtracker/` — natywny ESM (`"type": "module"`) z `emitDecoratorMetadata`
- **Problem**: Przy dwóch encjach importujących się nawzajem (np. `User` ↔ `Subscription`) metadane dekoratorów odwołują się do klasy, zanim moduł ją zainicjalizuje. Kończy się to błędem `ReferenceError: Cannot access 'User' before initialization`. W CommonJS ten sam kod działał.
- **Rule**: Typ pola relacji zapisujemy jako `Relation<User>` (z `typeorm`), a cel relacji zawsze jako funkcję `() => User`. Importy względne kończymy rozszerzeniem `.js`.
- **Applies to**: plan, implement

## Trasy zapisujemy po angielsku

- **Context**: `frontend-subtracker/` (`app.routes.ts`, `app.routes.server.ts`) i trasy API w `backend-subtracker/`
- **Problem**: W S-01 trasy frontendu powstały po polsku (`/rejestracja`, `/logowanie`), więc trzeba było je zmieniać razem z linkiem w mailu. Po wdrożeniu taka zmiana psuje wysłane linki i zakładki.
- **Rule**: Ścieżki tras są zawsze po angielsku, także nowe. Po polsku zostają tylko teksty w interfejsie.
- **Applies to**: plan, plan-review, implement, impl-review

## Indeksy tam, gdzie zapytanie albo klucz ich potrzebuje

- **Context**: `backend-subtracker/` — encje TypeORM i migracje; w S-02 `subscription.category_id` (FK) dostał indeks dopiero przy przeglądzie migracji
- **Problem**: Postgres nie zakłada indeksu na kolumnie klucza obcego. Bez niego usunięcie wiersza nadrzędnego (sprawdzenie FK, kaskada) i każde filtrowanie lub grupowanie po tej kolumnie skanuje całą tabelę; brak wychodzi dopiero przy większej liczbie danych. Wcześniej tak samo trzeba było dodać indeksy `user_id` w `session` i `magic_link_token` osobną migracją.
- **Rule**: Każda kolumna klucza obcego dostaje `@Index()`, chyba że jest pierwszą kolumną innego indeksu. Do tego indeks na kolumnach, po których zapytania filtrują, sortują albo łączą (np. status i daty dla jobów). Indeks bez zapytania, które go używa, nie powstaje. Przy przeglądzie wygenerowanej migracji sprawdzić, czy każdy FK ma indeks.
- **Applies to**: plan, plan-review, implement, impl-review

## Kod ogólny w `shared/`, logika domeny w module funkcji

- **Context**: `backend-subtracker/src/` — moduły funkcji (`auth/`, `subscriptions/`, …) i `src/shared/`; w S-02 walidator dnia `YYYY-MM-DD`, przycinany string i rozpoznanie błędu `23505` powstały jako prywatne funkcje modułu `subscriptions`, a stałe kategorii domyślnych trafiły do `shared/types`
- **Problem**: Ogólny kod schowany w module domeny jest kopiowany w kolejnych slice'ach zamiast używany ponownie, a stałe domeny w `shared/` łamią zasadę, że `shared/` to liść bez wiedzy o funkcjach.
- **Rule**: Walidatory, helpery bazy i funkcje bez wiedzy o domenie trafiają do `src/shared/<obszar>/` (`validation/`, `database/`, `decorators/`, `types/`…) z własnym testem jednostkowym obok. Moduł funkcji trzyma tylko logikę i stałe swojej domeny (reguły biznesowe, kolejność, odpowiedzi API, dane startowe). Przed napisaniem helpera sprawdzić, czy podobny nie istnieje już w `shared/`.
- **Applies to**: plan, implement, impl-review
