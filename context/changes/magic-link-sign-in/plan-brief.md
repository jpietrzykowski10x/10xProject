# Rejestracja i logowanie magic linkiem — Plan Brief

> Full plan: `context/changes/magic-link-sign-in/plan.md`

## What & Why

Budujemy rejestrację i logowanie magic linkiem (FR-001, US-01), bo wszystkie kolejne slice'y potrzebują zalogowanego użytkownika i izolacji kont. Link dostają tylko zarejestrowani użytkownicy. Przy okazji powstają guardy, role i moduł maili, z których korzysta reszta MVP.

## Starting Point

Backend ma tylko `GET /` i `GET /health`, bez encji i guardów. Frontend ma jedną tymczasową stronę ze statusem API i prerenderuje wszystkie trasy. Deploy z kopią bazy i migracjami działa na produkcji.

## Desired End State

Nowa osoba rejestruje się adresem i dwiema zgodami, dostaje jeden mail, klika link i „Zaloguj”, a potem widzi pustą listę subskrypcji. Zarejestrowana osoba loguje się tym samym przepływem. Każda trasa API poza publicznymi wymaga sesji, a aplikacja nie ujawnia, czy adres ma konto.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Konta | Osobna rejestracja; link tylko dla zarejestrowanych | Wymaganie użytkownika, zgodne z US-01 |
| Pola rejestracji | E-mail, oświadczenie 18+, akceptacja polityki, z datą i wersją zgody | Wybór użytkownika; dane są finansowe |
| Po rejestracji | Jeden mail: link potwierdza adres i loguje | Pasuje do celu 3 minut |
| Ujawnianie kont | Neutralne komunikaty; rejestracja na zajęty adres wysyła link logowania | Nie da się sprawdzić, kto korzysta z aplikacji |
| Skanery poczty | Strona z przyciskiem „Zaloguj”, token zużywa `POST` | Skaner otwierający link go nie spali |
| Starsze linki | Działa tylko najnowszy | Wybór użytkownika |
| Limity wysyłki | Brak na MVP | Wybór użytkownika, patrz ryzyka |
| Czasy | Link 15 minut; sesja stałe 30 dni, bez przedłużania | Wybór użytkownika |
| Ciasteczko | `Domain=.jakubpietrzykowski.pl` | Umożliwia późniejszy SSR tras zalogowanych |
| Renderowanie | `/subskrypcje` i `/auth/potwierdz` w `RenderMode.Client` | Lista jest pusta, SSR dojdzie, gdy da realny zysk |
| Zakres wzorców | Pełny: guard ról, `admin:grant`, `mail`, `NOTIFICATION_*` | Wybór użytkownika |
| Poczta | SMTP MyDevil | Użytkownik potwierdził doręczanie na Gmaila w innych projektach |
| Polityka prywatności | Strona „w przygotowaniu”; tekst przed publicznym startem | Wybór użytkownika, patrz ryzyka |

## Scope

**In scope:**

- Rejestracja, prośba o link, potwierdzenie, wylogowanie, `GET /auth/me`
- Encje `user`, `role`, `user_role`, `session`, `magic_link_token`, `mail` oraz dwie migracje
- Globalne guardy, `@Public()`, `@Roles()`, `ValidationPipe`
- Dwa transportery maili, audyt, powiadomienie operatora o błędzie wysyłki
- Skrypt `admin:grant`
- Strony frontendu z pustą listą

**Out of scope:**

- Limity wysyłki i pełny tekst polityki
- SSR tras zalogowanych i encja `Subscription` (S-02)
- Panel admina (S-09), czyszczenie starych danych, usuwanie konta
- Logowanie hasłem, runner testów frontendu

## Architecture / Approach

Frontend woła API z `withCredentials`. `POST /auth/register` lub `/auth/request-link` tworzy token i po commicie wysyła mail, nie czekając na SMTP w odpowiedzi. Link prowadzi na `/auth/potwierdz#token=...`, a przycisk wysyła `POST /auth/verify`, który atomowo zużywa token, tworzy sesję i ustawia ciasteczko. Globalny guard sesji dopina `request.user`, a guard ról sprawdza `@Roles()`.

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. Konfiguracja i moduł maili | Walidacja env, dwa transportery, audyt | `validateEnv` obsługuje też CLI migracji |
| 2. Encje, sesje i guardy | Dostęp domyślnie chroniony, `/auth/me`, wylogowanie, `admin:grant` | Brak `@Public()` na `/health` cofa deploy |
| 3. Rejestracja i magic link | Pełny przepływ API, e2e, migracje | Baza dev nie ma seedu ról z migracji |
| 4. Frontend | Strony i tryby renderowania | Trasy zalogowanych nie mogą być prerenderowane |
| 5. Wdrożenie | Klucze na serwerze, dokumentacja, test produkcyjny | Brak kluczy w `shared/.env` przerywa deploy na migracjach |

**Prerequisites:** F-01 zmergowane; skrzynka SMTP na MyDevil dla nadawcy; lokalny PostgreSQL do e2e.

**Estimated effort:** ok. 4–6 sesji po kilka godzin, przy 5 fazach.

## Open Risks & Assumptions

- **Brak limitów + tylko najnowszy link:** każdy, kto zna czyjś adres, może seryjnie unieważniać jego linki, blokując logowanie, zasypywać skrzynkę i psuć reputację poczty MyDevil, potrzebnej też w S-06. Przywrócenie ochrony to mały dodatek: 1 link na 60 sekund per adres. Warto wrócić do tego przed publicznym startem.
- **Zgoda na tekst, którego nie ma:** do czasu publikacji polityki zapisana zgoda niewiele znaczy. Zapisujemy wersję `0-placeholder`, żeby dało się później rozpoznać, kto akceptował wersję zastępczą. Przed publicznym startem trzeba mieć tekst.
- **Ciasteczko na domenie nadrzędnej:** trafia do każdej subdomeny `jakubpietrzykowski.pl`, także innych projektów, jeśli działają pod tą domeną. To świadomy koszt możliwości SSR.
- **Utracone maile:** wysyłka nie jest ponawiana, więc restart procesu w trakcie wysyłki gubi mail. Użytkownik prosi wtedy o link ponownie.
- **Reszta różnicy czasów:** założenie konta trwa nieco dłużej niż obsługa zajętego adresu, więc pomiar czasu daje słaby sygnał o istnieniu konta. Akceptowalne na MVP.
- **Założenia do sprawdzenia w fazie 5:** Outlook oraz SPF/DKIM dla `jakubpietrzykowski.pl`. Doręczanie na Gmaila potwierdzono tylko z innych projektów.

## Success Criteria (Summary)

- Nowy użytkownik przechodzi na produkcji od wejścia na stronę do pustej listy w mniej niż 3 minuty.
- Link działa raz, przez 15 minut, a otwarcie go przez skaner nie loguje i nie spala tokenu.
- Bez sesji API zwraca `401`, a deploy z `/health` działa jak wcześniej.
