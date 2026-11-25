# MyDevil deploy scripts

[Polski](#polski) · [English](#english)

Back to the main README / powrót do głównego README: [`../../README.md`](../../README.md)

---

## Polski

Skrypty serwerowe do wdrażania SubTrackera na MyDevil. Na serwerze leżą w `~/apps/subtracker/bin` i nie instalują się same. Po zmianie skryptu tutaj trzeba go wgrać ponownie; zobacz [Aktualizacja skryptów na serwerze](#aktualizacja-skryptów-na-serwerze).

W przykładach `<frontend-domain>`, `<api-domain>` i `<parent-domain>` to miejsca na własne domeny (np. frontend i API jako dwie subdomeny jednej domeny nadrzędnej), `<login>` i `s<N>` to login i serwer konta MyDevil. Prawdziwych wartości nie wpisujemy do plików w repo.

### Układ katalogów na serwerze

```
~/apps/subtracker/frontend/          ~/apps/subtracker/api/
  public_nodejs/      działająca wersja (uruchamia ją forever)
  public_nodejs_new/  wersja instalowana w trakcie deployu
  releases/           poprzednie wersje, z node_modules (3 najnowsze)
  shared/.env         PORT=..., NODE_ENV=production (chmod 600), kopiowany do każdego wydania
  logs/               forever.log, out.log, err.log

~/apps/subtracker/backups/   (drwx------) kopie bazy api sprzed każdego deployu,
                             <YYYYmmdd-HHMMSS>_<sha7>.dump (-rw-------), 10 najnowszych,
                             żadna starsza niż 180 dni (zob. Kopie bazy i usunięte konta)

~/apps/subtracker/watchdog/  (drwx------) state.json watchdoga: liczniki porażek i czas
                             ostatniego maila, poza wydaniami, więc deploy go nie kasuje
```

`shared/.env` api zawiera też ustawienia bazy, CORS, ciasteczka sesji i poczty (szablon: `backend-subtracker/.env.example`, kopia lokalna `backend-subtracker/.env.mydevil`):

```
MODE=PROD
PORT=<PORT_API>
NODE_ENV=production
POSTGRES_HOST=...          # z `devil pgsql db add`; bez POSTGRES_DATABASE_DEV
POSTGRES_PORT=5432
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=...
DATABASE_AUTO_SYNCHRONIZATION=false   # true w PROD jest odrzucane przy starcie
CORS_ORIGINS=https://<frontend-domain>
FRONTEND_URL=https://<frontend-domain>   # sam origin https, cel linków logowania
SESSION_COOKIE_DOMAIN=.<parent-domain>
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false                     # false = STARTTLS na 587, true = TLS na 465
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_FROM_EMAIL=...
SMTP_FROM_NAME=SubTracker
NOTIFICATION_ADMINISTRATOR_MAIL=...
SUPPORT_EMAIL=...                     # kontakt pokazywany zablokowanemu kontu (komunikat i mail)
LOG_ERROR_STACKS=true                 # opcjonalne, domyślnie true; false ukrywa stosy wywołań w logu błędów
```

Aplikacja i migracje sprawdzają te ustawienia przy starcie, więc brakujący albo niespójny klucz zatrzymuje deploy na etapie migracji, a poprzednia wersja startuje ponownie. W `MODE=PROD`:

- `FRONTEND_URL`, `SESSION_COOKIE_DOMAIN`, `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `NOTIFICATION_ADMINISTRATOR_MAIL` i `SUPPORT_EMAIL` są wymagane. `SUPPORT_EMAIL` (od S-09) dopisz do `shared/.env` **przed** pierwszym deployem, który go wymaga: sprawdza go także CLI migracji w `deploy.sh`, więc bez niego deploy cofnie się na etapie migracji.
- `CORS_ORIGINS` musi zawierać `FRONTEND_URL`.
- `SESSION_COOKIE_DOMAIN` musi obejmować hosta z `FRONTEND_URL`.
- `NOTIFICATION_SMTP_HOST`, `NOTIFICATION_SMTP_USERNAME`, `NOTIFICATION_SMTP_PASSWORD` i `NOTIFICATION_SMTP_FROM_EMAIL` są wymagane (od S-12): to osobna skrzynka tylko na alarmy operatora, z loginem innym niż `SMTP_USERNAME` (ten sam host MyDevil jest w porządku). Dzięki temu zablokowana albo padnięta skrzynka maili do użytkowników nie ucisza alarmów. Bez tych kluczy albo z tym samym loginem nie przejdzie `migration:run` w `deploy.sh` ani start api (deploy się wycofa), a skrypty ról i watchdog kończą się błędem. Kanał sprawdzisz skryptem testowym (niżej, „Test kanału alarmów”).

Skrypty wczytują ten plik przez `sh` (`. .env`) i eksportują go, więc aplikacja dostaje to, co `sh` zrobił z każdej linii. Wartości wpisuj zwykłe albo w apostrofach (`KEY='dwa słowa'`); nigdy nie zostawiaj bez cudzysłowu `$`, `` ` ``, `"`, `\` ani `#`. Hasła tylko z liter i cyfr (`openssl rand -hex 16`). Klucze nie mogą się powtarzać: `deploy.sh` czyta `PORT` przez `sed`, a druga linia `PORT=` psuje health-check.

Domeny to domeny proxy MyDevil, TLS kończy się na MyDevil:

- `<frontend-domain>` → `localhost:<PORT_FE>`
- `<api-domain>` → `localhost:<PORT_API>`

### Skrypty

| Skrypt | Do czego służy |
|---|---|
| `ci-gate.sh` | Wymuszone polecenie dla klucza CI. Przyjmuje tylko `deploy <frontend\|api> <sha>`. |
| `deploy.sh <app> <sha>` | Rozpakowuje paczkę ze stdin do `public_nodejs_new`, uruchamia `npm24 ci --omit=dev`, podmienia wersje przez `mv` i robi health-check (`/health` dla api, `/` dla frontendu). Dla api najpierw zatrzymuje działającą wersję, robi kopię bazy i uruchamia migracje (zob. [Baza danych](#baza-danych)). Gdy health-check się nie powiedzie, sam przywraca poprzednią wersję. |
| `restore-db.sh <plik.dump>` | Przywraca bazę api z kopii: najpierw zapisuje bieżący stan do `backups/<czas>_pre-restore.dump` (10 najnowszych), potem usuwa i zakłada od nowa schemat `public` i odtwarza kopię, w jednej transakcji. Po udanym przywróceniu uruchamia `prune-backups.sh`. Nie zatrzymuje ani nie uruchamia api. |
| `prune-backups.sh [plik-do-zachowania]` | Usuwa z `backups/` kopie api starsze niż 180 dni, ale gdy żadna kopia nie jest młodsza niż 30 dni, najpierw robi świeżą `<czas>_scheduled.dump`. Uruchamiany codziennie z crontaba oraz przez `deploy.sh` (api) i `restore-db.sh`. Zob. [Kopie bazy i usunięte konta](#kopie-bazy-i-usunięte-konta). |
| `stop-app.sh <app>` | Zatrzymuje aplikację: `forever stop` z limitem 30 s, potem zabija monitor forever i aplikację po ścieżce. `forever stop` potrafi zawisnąć na stałe, gdy aplikacja wpada w pętlę restartów. Wszystkie inne skrypty zatrzymują aplikacje przez niego. |
| `start-app.sh <app>` | Uruchamia aplikację od nowa pod `forever` na `/usr/local/bin/node24`, ze zmiennymi z `.env`. Plik startowy: `app.mjs` (frontend) / `app.js` (api), bo MyDevil uruchamia tylko te nazwy. |
| `rollback.sh <app> [--yes]` | Przywraca najnowsze wydanie z `releases/`. Dla api przywraca też bazę z kopii zrobionej przed wycofywanym wydaniem (pyta o `TAK`). Frontend wycofuje tylko kod. Kończy się health-checkiem. |
| `start-all.sh` | Uruchamia obie aplikacje po restarcie serwera. |
| `watchdog.sh` | Co 5 minut z crontaba sprawdza na `localhost` api (`/health`, także stan jobów) i frontend (`/`) i mailuje operatorowi, gdy któryś leży. Milczy w czasie deployu, rollbacku i przywrócenia. Zob. [Watchdog: alarmy dla operatora](#watchdog-alarmy-dla-operatora). |

### Baza danych

PostgreSQL na serwerze to wersja 16.10. Migracje używają `gen_random_uuid()`, co wymaga wersji 13 lub nowszej.

Deploy api to świadomy krok z krótką przerwą (ok. 30–60 s), w tej kolejności:

1. Nowa wersja instaluje się obok działającej (`npm24 ci`).
2. Działające api zostaje zatrzymane. Od tej chwili nic nie pisze do bazy.
3. `pg_dump -Fc` zapisuje `~/apps/subtracker/backups/<czas>_<sha7>.dump`.
4. `migration:run` z nowego wydania, cała partia w jednej transakcji.
5. Do nowego wydania trafia `.deploy-info` (`SHA`, `BACKUP`), wersje są podmieniane, nowa startuje i musi przejść health-check na `/health`, który odpytuje bazę.

Ścieżki błędów:

- **Kopia albo migracja się nie udaje**: stara wersja startuje ponownie, a deploy się zatrzymuje. Nieudaną partię migracji PostgreSQL wycofuje, więc baza jest taka jak przedtem.
- **Health-check nie przechodzi po migracjach**: nowa wersja zostaje zatrzymana, baza wraca z kopii z kroku 3, a poprzednia wersja startuje ponownie. Jeśli to przywrócenie się nie uda, deploy kończy się głośnym błędem, a api zostaje zatrzymane: stary kod na niepasującym schemacie jest gorszy niż przerwa.
- `public_nodejs_new` (albo `releases/<czas>_failed`) zostaje do diagnozy.

Ręczne przywrócenie, np. gdy problem wychodzi kilka godzin po deployu:

```
~/apps/subtracker/bin/stop-app.sh api
~/apps/subtracker/bin/restore-db.sh ~/apps/subtracker/backups/<czas>_<sha7>.dump
~/apps/subtracker/bin/start-app.sh api
```

`rollback.sh api` robi to samo razem z kodem: przywraca kopię wskazaną w `.deploy-info` działającego wydania, czyli bazę sprzed jego deployu, a potem uruchamia poprzednie wydanie. **Dane zapisane od tego deployu znikają z działającej bazy.** `restore-db.sh` zachowuje je w `backups/<czas>_pre-restore.dump`, więc pomyłkowy rollback da się cofnąć, przywracając ten plik (najpierw zatrzymaj api). Wydanie wdrożone, zanim powstały kopie, nie ma `.deploy-info` i rollback odmawia.

Wydania w `releases/` nazywają się `<czas>_<sha7>` od SHA, które zawierają (`.deploy-info`); nieudane deploye kończą się na `_failed`, wycofane na `_rolledback`. Deploy, rollback i ręczne przywrócenie jednej aplikacji biorą blokadę (`~/apps/subtracker/<app>/.ops.lock`), więc nigdy się nie nakładają; frontend i api mogą jednak wdrażać się jednocześnie. Blokadę zostawioną przez zabity proces usuwa się przez `rmdir`.

**Wdrożona wersja i logi.** Obie aplikacje czytają przy starcie `SHA` z `.deploy-info` swojego wydania (nigdy `BACKUP`); bez pliku podają `dev`. Wdrożoną wersję sprawdzisz na dwa sposoby: `curl -s localhost:<PORT_API>/health` zwraca pole `"version":"<sha>"` (także w odpowiedzi 503), a `logs/out.log` każdej aplikacji ma po starcie linię `Started <APPLICATION_NAME> version <sha> on port …` (api) albo `Started subtracker-frontend version <sha> on port …`. Linie obu aplikacji mają format `[<app>] <pid>  - <czas ISO Europe/Warsaw z offsetem> <POZIOM> [<kontekst>] <wiadomość>`, bez kodów kolorów ANSI (kolory są tylko w terminalu). Każde żądanie zostawia w `out.log` jedną linię `[Access]`: w api `<METODA> <szablon trasy|(unrouted)> <status|aborted> <ms> ms user=<uuid|-> req=<uuid>`, we frontendzie `<METODA> <ścieżka> <status|aborted> <ms> ms` (bez plików statycznych). Żadna z nich nie ma query ani tokenów; linia api nie ma też adresów (tylko szablon trasy), a frontend zapisuje ścieżkę tak, jak wysłał ją klient, więc ręcznie wpisany adres w ścieżce (np. `/sign-in/anna@example.com`) trafi do `out.log` (linki aplikacji nie mają adresów w ścieżce, adresy idą tylko w odrzucanym `?q=`); zapytania watchdoga i health-checków deployu też są logowane.

Nigdy nie uruchamiaj `migration:revert` na produkcji: metody `down()` są zawodne. Powrót to zawsze przywrócenie z kopii.

**Zadania cykliczne.** Api uruchamia swoje joby (cykl życia subskrypcji: koniec triali, dokończenie anulowań, przesuwanie dat rozliczeń; sprzątanie tokenów logowania i sesji starszych niż 7 dni) raz przy każdym starcie, zanim przyjmie żądania, a potem codziennie o 00:05 czasu Europe/Warsaw. Nic tu nie wymaga ręcznego kroku: to, co ominęło w czasie zatrzymania api (deploy przez północ, restart przez MyDevil, reboot), nadrabia następny start, a drugi przebieg tego samego dnia nic nie zmienia. Po rollbacku albo ręcznym przywróceniu kopii baza wraca do stanu sprzed deployu, a następny start wersji z jobami sam powtarza przejścia. Wydanie sprzed jobów ich nie uruchamia, więc po wycofaniu do niego daty zostają takie, jak w przywróconej kopii, dopóki nie wystartuje nowsza wersja. Każdy przebieg (także przypomnień o trialu o 02:00) zapisuje wiersz w tabeli `job_run` i jedną linię podsumowania w logu. Przebieg nieudany (`failed`) albo częściowy (`partial`, np. część użytkowników bez przypomnienia) trafia do `logs/err.log` i wysyła mail na `NOTIFICATION_ADMINISTRATOR_MAIL` (temat `SubTracker: zadanie <job> — <wynik>`), ale nie psuje startu ani health-checku. `GET /health` zwraca w polu `jobs` stan każdego joba (`ok`, `stale` = brak zakończonego przebiegu od 26 h, `failed`); kod odpowiedzi zależy tylko od bazy. Nieobsłużony wyjątek procesu zostawia w `err.log` jedną linię `Fatal ...` i kończy proces, a `forever` go podnosi.

### Kopie bazy i usunięte konta

Użytkownik może usunąć konto w aplikacji (`/account`). Usunięcie w działającej bazie jest natychmiastowe i ostateczne: konto i wszystkie jego dane znikają. Kopie bazy nadal mają te dane, dopóki ich nie usuniemy, dlatego ich wiek jest ograniczony.

- **Kopie żyją najwyżej 180 dni.** `backups/` trzyma kopie sprzed każdego deployu api (`<czas>_<sha7>.dump`, 10 najnowszych), sprzed każdego przywrócenia (`<czas>_pre-restore.dump`, 10 najnowszych) i kopie planowe (`<czas>_scheduled.dump`, rotowane razem z kopiami deployu). Niezależnie od liczby `prune-backups.sh` usuwa każdą kopię starszą niż 180 dni. Działa codziennie z crontaba (zob. [Jednorazowa konfiguracja](#jednorazowa-konfiguracja)), po każdym deployu api i po każdym udanym przywróceniu (które przekazuje przywróconą kopię, żeby nigdy jej nie usunąć).
- **Zawsze jest kopia nie starsza niż miesiąc.** Zanim cokolwiek usunie, `prune-backups.sh` szuka kopii młodszej niż 30 dni. Gdy jej nie ma (np. miesiąc bez deployu), najpierw robi świeżą `<czas>_scheduled.dump` i usuwa dopiero po jej powodzeniu. Sprzątanie nigdy nie zostawia pustego `backups/`.
- **Nieudana kopia niczego nie usuwa.** Skrypt kończy się kodem 1, a log crona `~/apps/subtracker/api/logs/prune-backups.log` mówi `database backup FAILED; nothing deleted` (po deployu albo przywróceniu komunikat jest w ich wyjściu; sam deploy czy przywrócenie i tak liczy się jako udane). Usuń przyczynę (zwykle ustawienia bazy w `shared/.env`) i uruchom `~/apps/subtracker/bin/prune-backups.sh` ręcznie. Gdy trwa deploy, rollback albo przywrócenie, przebieg z crona nic nie robi i kończy się kodem 0; tamta operacja posprząta sama.
- **Rollback starego wydania może zostać odrzucony.** `rollback.sh api` potrzebuje kopii wskazanej w `.deploy-info` wydania. Gdy jest starsza niż 180 dni, już jej nie ma i rollback zatrzymuje się z `backup ... not found; nothing changed`. Po awarii przywróć wtedy najnowszą kopię przez `restore-db.sh` (zob. [Baza danych](#baza-danych)).
- **Własna codzienna kopia konta na MyDevil** ma okres przechowywania, na który nie mamy wpływu. Ta reguła jej nie obejmuje.
- **Przywrócenie albo rollback przywraca usunięte konta.** Każde konto usunięte po zrobieniu kopii znowu jest w przywróconej bazie. Po przywróceniu usuń te konta ponownie (operator musi wiedzieć które, np. z próśb użytkowników).
- **Archiwum maili jest zanonimizowane.** Usunięcie konta zostawia jego wiersze w tabeli `mail` (typ, status, daty), ale zamienia adres na `zanonimizowano@anonymized.invalid` i czyści komunikat błędu. Poczta idzie tylko na adresy, które nadal mają konto.

Co musi o tym powiedzieć pełna polityka prywatności (pisana osobno, przed publicznym startem):

- usunięcie konta od razu usuwa dane z działającej bazy;
- kopie bazy przechowują dane do 180 dni, potem są usuwane; kopia MyDevil ma własny okres przechowywania;
- po przywróceniu kopii usunięcia zrobione od tamtej chwili są powtarzane;
- rejestr wysłanych maili zostaje bez adresu.

### Nadawanie i odbieranie ról (ADMIN, SUPER_ADMIN)

Role nadaje i odbiera się wyłącznie skryptem na serwerze (API do zarządzania rolami nie ma), gdy konto już istnieje, czyli po rejestracji użytkownika. `npm run admin:grant` i pozostałe skrypty `npm run` są tylko do użytku lokalnego: `prepare-mydevil.mjs` spłaszcza `dist/` do katalogu głównego paczki, więc skrypty leżą w `cli/`. Plików `.js` nie uruchamia się bezpośrednio (`cli/superadmin-grant.js <mail>` kończy się `Permission denied`): uruchamia je `node24` z działającego wydania z wyeksportowanym env, tak jak `deploy.sh` uruchamia migracje.

| Cel | Skrypt |
| --- | --- |
| nadać `ADMIN` (zarządza zwykłymi użytkownikami) | `cli/admin-grant.js` |
| odebrać `ADMIN` | `cli/admin-revoke.js` |
| nadać `SUPER_ADMIN` (jeden, zarządza też adminami) | `cli/superadmin-grant.js` |
| odebrać `SUPER_ADMIN` | `cli/superadmin-revoke.js` |

```
cd ~/apps/subtracker/api/public_nodejs
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/admin-grant.js "$1"' sh <mail>
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/admin-revoke.js "$1"' sh <mail>
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/superadmin-grant.js "$1"' sh <mail>
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/superadmin-revoke.js "$1"' sh <mail>
```

Sukces wypisuje jedną linię z rolą, czynnością i adresem. Ponowne nadanie albo odebranie roli nie szkodzi. Nieznany adres wypisuje błąd i kończy się kodem 1. Superadmin może być jeden: gdy rolę ma już inne konto, `superadmin-grant.js` kończy się kodem 1 z komunikatem „Superadmin już istnieje”, więc najpierw uruchom `superadmin-revoke.js` dla poprzedniego. Zmiana roli działa od następnego żądania konta, bez wylogowania (w przeglądarce wystarczy odświeżyć stronę).

### Aktualizacja skryptów na serwerze

Skryptów **nie** wdraża GitHub Actions: workflowy wysyłają tylko paczki aplikacji, a zmiany w `deploy/` ich nie uruchamiają. Po zmianie dowolnego skryptu wgraj go ręcznie.

1. Lokalnie, z katalogu głównego repo (PowerShell albo Git Bash). Pliki wymień jawnie, bo PowerShell nie rozwija `*.sh` dla `scp`:

   ```
   scp deploy/mydevil/ci-gate.sh deploy/mydevil/deploy.sh deploy/mydevil/restore-db.sh deploy/mydevil/stop-app.sh deploy/mydevil/start-app.sh deploy/mydevil/rollback.sh deploy/mydevil/start-all.sh deploy/mydevil/prune-backups.sh deploy/mydevil/watchdog.sh <login>@s<N>.mydevil.net:~/apps/subtracker/bin/
   ```

   Tak samo wgrasz pojedynczy zmieniony plik, np. tylko `deploy/mydevil/start-app.sh`.

2. Na serwerze (po `ssh <login>@s<N>.mydevil.net`, nie w lokalnym terminalu; albo jednym poleceniem `ssh <login>@s<N>.mydevil.net '<polecenia>'`):

   ```
   chmod 700 ~/apps/subtracker/bin/*.sh
   ls -l ~/apps/subtracker/bin
   sha256 ~/apps/subtracker/bin/*.sh
   SSH_ORIGINAL_COMMAND="ls" ~/apps/subtracker/bin/ci-gate.sh
   ```

   Oczekiwany wynik: każdy skrypt ma `-rwx------`, a ostatnie polecenie wypisuje `ci-gate: rejected command: ls`. Sumy kontrolne muszą się zgadzać z repo: lokalnie uruchom `sha256sum deploy/mydevil/*.sh` (Git Bash) na commicie, z którego wgrywałeś. Porównaj **wszystkie** skrypty, nie tylko zmienione: kopia na serwerze jest aktualizowana ręcznie i może się rozjechać. Niezgodność to zwykle końce linii CRLF (`.gitattributes` im zapobiega dla `*.sh`) albo zapomniane wgranie. Na FreeBSD polecenie to `sha256`, nie `sha256sum`.

3. Jeśli zmieniłeś `start-app.sh`, zastosuj go do działających procesów:

   ```
   ~/apps/subtracker/bin/start-app.sh api
   ~/apps/subtracker/bin/start-app.sh frontend
   forever list
   ```

   Zmiany w `deploy.sh` i `ci-gate.sh` działają od następnego deployu. Zmiany w `stop-app.sh`, `restore-db.sh`, `rollback.sh`, `start-all.sh`, `prune-backups.sh` i `watchdog.sh` — od ich następnego uruchomienia.

Lokalna próba `prune-backups.sh` przed wgraniem: `sh dev-local/prune-backups-trial.sh` (zob. [`dev-local/README.md`](../../dev-local/README.md)).

### Watchdog: alarmy dla operatora

`watchdog.sh` (od S-11) uruchamiany z crontaba co 5 minut pilnuje, żeby o awarii operator dowiedział się z maila, a nie od użytkownika. Sam skrypt tylko przygotowuje środowisko: czyta `PORT` z `api/public_nodejs/.env` i `frontend/public_nodejs/.env` (plik frontendu czyta jako tekst, nie wykonuje go), a potem uruchamia `/usr/local/bin/node24 cli/watchdog.js` z działającego wydania api z wyeksportowanym `.env` api. Polityka i treść maili są w paczce api (`src/watchdog/`), więc zmieniają się z deployem api.

Sprawdzane cele:

- **api**: `GET localhost:<PORT_API>/health` zwraca 2xx i `status: ok`;
- **frontend**: `GET localhost:<PORT_FE>/` zwraca 2xx;
- **jobs**: pole `jobs` z `/health`. Porażka, gdy któryś job jest `stale` (brak zakończonego przebiegu od 26 h) albo gdy `/health` odpowiada 200 bez poprawnego pola `jobs`. Joby `failed` mailuje samo api, watchdog ich nie powtarza. Gdy api leży, cel `jobs` nie jest oceniany.

Maile idą na `NOTIFICATION_ADMINISTRATOR_MAIL` transportem operatora (`NOTIFICATION_SMTP_*`), bez bazy: nie powstaje wiersz w tabeli `mail`. Dla każdego celu:

- po 3 kolejnych porażkach (ok. 15 minut): `SubTracker: API nie odpowiada`, `SubTracker: Frontend nie odpowiada` albo `SubTracker: zadanie cykliczne nie ruszyło od 26 h` (`... stan zadań cyklicznych nieczytelny`, gdy brak pola `jobs`); gdy api odpowiada, ale `/health` zgłasza bazę danych (503, `db: error`), temat brzmi `SubTracker: API bez bazy danych` (temat opisuje sprawdzenie, przy którym wychodzi mail, więc przypomnienie może nazwać przyczynę inaczej niż pierwszy alarm);
- dopóki cel leży, przypomnienie co 12 h (`... nadal ...`);
- po powrocie jeden mail `... działa ponownie`.

Mail, który się nie wysłał, nie zmienia stanu alarmu, więc następny przebieg spróbuje ponownie. Stan leży w `~/apps/subtracker/watchdog/state.json` (zapis atomowy, poza wydaniami). Log `~/apps/subtracker/api/logs/watchdog.log` dostaje linię tylko przy mailu (wysłanym albo nie), przy pominiętym przebiegu albo przy błędzie samego watchdoga; spokojny przebieg nic nie pisze.

W czasie deployu, rollbacku i przywrócenia (`api/.ops.lock` albo `frontend/.ops.lock` młodszy niż 30 minut) przebieg jest pomijany z kodem 0, więc zwykły deploy nie daje alarmu. Starsza blokada (zostawiona przez zabity proces) nie ucisza watchdoga: każdy przebieg zapisuje ją w logu, dopóki nie usuniesz jej przez `rmdir`. Kod wyjścia 1 oznacza, że watchdog nie może działać (brak `.env`, brak `PORT`, zły env api); wtedy nie wysyła żadnego maila, a przyczyna jest w logu.

Jednocześnie działa jeden przebieg: watchdog bierze blokadę `~/apps/subtracker/watchdog/.run.lock`, a gdy poprzedni przebieg jeszcze trwa, kończy się kodem 0 z wpisem w logu. Przebieg jest przerywany po 240 s (`timeout`, kod 124 z wpisem w logu), więc blokada starsza niż 15 minut została po przebiegu zabitym bez sprzątania (SIGKILL, restart serwera): kolejny przebieg ją przejmuje i zapisuje to w logu, nie trzeba jej usuwać ręcznie. Gdy blokady nie da się założyć z innego powodu (uprawnienia, pełny dysk), przebieg kończy się kodem 1.

**Instalacja** (raz, po deployu api zawierającym `cli/watchdog.js`):

1. Wgraj `watchdog.sh` i sprawdź go jak resztę skryptów: `scp`, `chmod 700`, porównanie `sha256` z repo (zob. [Aktualizacja skryptów na serwerze](#aktualizacja-skryptów-na-serwerze)).
2. Na serwerze sprawdź, że api zgłasza joby, i uruchom watchdoga raz ręcznie:

   ```
   curl -s localhost:<PORT_API>/health
   ~/apps/subtracker/bin/watchdog.sh; echo "exit $?"
   cat ~/apps/subtracker/watchdog/state.json
   ```

   Oczekiwany wynik: `/health` zawiera `"jobs"` z `ok` dla trzech jobów, watchdog nic nie wypisuje i kończy się `exit 0`, nie przychodzi żaden mail, a `state.json` ma `"failures": 0` dla `api`, `frontend` i `jobs`.
3. Dodaj linię watchdoga do crontaba (zob. [Jednorazowa konfiguracja](#jednorazowa-konfiguracja)).

**Wyciszenie:** zakomentuj linię watchdoga w crontabie (`crontab -e`, `#` na początku). Po odkomentowaniu watchdog kontynuuje od zapisanego stanu: cel, który był w alarmie i już działa, dostanie mail o powrocie. Usunięcie `state.json` zeruje liczniki (bez maila o powrocie).

**Ograniczenia:**

- Sprawdza tylko `localhost`, tak jak health-check `deploy.sh`. Awaria proxy MyDevil, DNS albo TLS jest dla niego niewidoczna.
- Działa z wydania api: zepsuta paczka api (brak `cli/watchdog.js`, zły `.env`) wyłącza też watchdoga. Ślad zostaje tylko w `watchdog.log`.
- Alarmy idą osobną skrzynką, ale tą samą pocztą MyDevil co maile do użytkowników. Awaria całej poczty MyDevil ucisza więc też alarmy; ślad zostaje w `watchdog.log` (przyjęte ograniczenie).

**Test kanału alarmów.** Po deployu api, po zmianie hasła skrzynki alarmów albo gdy alarmy przestały przychodzić: `cd ~/apps/subtracker/api/public_nodejs && node cli/operator-test-mail.js; echo "exit $?"`. Skrypt wypisuje, którym kanałem wysyła (`operator channel: separate (<nadawca>)`), i wysyła jeden mail `SubTracker: test kanału alarmów` na `NOTIFICATION_ADMINISTRATOR_MAIL`. `exit 0` oznacza, że serwer pocztowy przyjął mail; `exit 1` to zły `.env`, brak adresu operatora albo odrzucenie (w linii tylko kod i rozszerzony status SMTP, bez adresu). Lokalnie: `npm run operator:test-mail` w `backend-subtracker/` (w DEV bez `NOTIFICATION_SMTP_HOST` linia mówi `shared with SMTP_* (DEV)`, czyli osobna skrzynka nie została sprawdzona).

**Alarm o nieudanej wysyłce maila.** Gdy api nie wyśle maila do użytkownika, mailuje operatorowi `SubTracker: nieudana wysyłka maila` z id wiersza audytu, typem maila i liczbą porażek pominiętych od poprzedniego alarmu. Każdy typ maila ma osobne okno: po przyjętym alarmie następny tego typu najwcześniej po 15 minutach, po nieudanym próba ponowiona najwcześniej po minucie. Porażki z czasu okna operator zobaczy jako liczbę dopiero w następnym alarmie tego typu; jeśli potem nic nie padnie, zostają tylko w `err.log` i w tabeli `mail`. Odrzucenie adresu odbiorcy jako nieistniejącego albo błędnego (status SMTP 5.1.1, 5.1.2, 5.1.3, 5.1.6, 5.1.10) to literówka użytkownika: tylko linia `warn` w `out.log`, bez alarmu. Każde inne odrzucenie (np. 5.1.7 i 5.1.8 przy złym nadawcy, 5.7.1 przy relayu, limit wysyłki, SPF/DMARC) daje alarm, a linia w `err.log` podaje kod i status SMTP.

Lokalna próba przed wgraniem albo po zmianie `src/watchdog/`: `dev-local/watchdog-trial.mjs` (zob. [`dev-local/README.md`](../../dev-local/README.md)).

### Jednorazowa konfiguracja

Wpis w `authorized_keys` dla klucza GitHub Actions. Użyj ścieżki bezwzględnej:

```
command="/usr/home/<login>/apps/subtracker/bin/ci-gate.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-actions-subtracker
```

crontab:

```
@reboot /usr/home/<login>/apps/subtracker/bin/start-all.sh >> /usr/home/<login>/apps/subtracker/api/logs/start-all.log 2>&1
0 4 * * 0 find /usr/home/<login>/apps/subtracker/*/logs -name '*.log' -size +20M -exec truncate -s 0 {} \;
30 4 * * * /usr/home/<login>/apps/subtracker/bin/prune-backups.sh >> /usr/home/<login>/apps/subtracker/api/logs/prune-backups.log 2>&1
*/5 * * * * /usr/home/<login>/apps/subtracker/bin/watchdog.sh >> /usr/home/<login>/apps/subtracker/api/logs/watchdog.log 2>&1
```

Przed wklejeniem zamień każde `<login>` na nazwę konta. Cron uruchamia linię przez `/bin/sh`, który czyta `<login>` jako przekierowanie z pliku `login`: linia kończy się błędem `cannot open login: No such file or directory` jeszcze przed startem skryptu, a błąd trafia tylko do lokalnej skrzynki `/var/mail/<login>`. Po zapisaniu sprawdź `crontab -l | grep '<login>'` (nie powinno nic wypisać).

Linia `prune-backups.sh` codziennie usuwa kopie bazy starsze niż 180 dni, także bez deployów (zob. [Kopie bazy i usunięte konta](#kopie-bazy-i-usunięte-konta)). Po dodaniu uruchom ją raz ręcznie; powinna skończyć się linią `done: <n> dump(s) deleted`. Linia `watchdog.sh` co 5 minut sprawdza api i frontend (zob. [Watchdog: alarmy dla operatora](#watchdog-alarmy-dla-operatora)); przed dodaniem uruchom go raz ręcznie.

Skrypty oczekują `forever` w `PATH`. Szukają w `/usr/local/bin` i `~/.npm-global/bin`. Jeśli Twój jest gdzie indziej, popraw linię `PATH` na początku każdego skryptu.

Na tym koncie pod `forever` działają też inne aplikacje. Procesy SubTrackera zatrzymuj przez `stop-app.sh <app>` (po uid, z zapasowym zabiciem po ścieżce), nigdy przez `forever stopall`. Skrypty potrzebują `timeout` i `pkill`, oba są w systemie bazowym FreeBSD.

---

## English

Server-side scripts for deploying SubTracker to MyDevil. They live in `~/apps/subtracker/bin` on the server and are not installed automatically. After changing them here, upload them again; see [Updating the scripts on the server](#updating-the-scripts-on-the-server).

In the examples, `<frontend-domain>`, `<api-domain>` and `<parent-domain>` stand for your own domains (e.g. the frontend and the API as two subdomains of one parent domain); `<login>` and `s<N>` are the MyDevil account login and server. Real values never go into files in the repo.

### Server layout

```
~/apps/subtracker/frontend/          ~/apps/subtracker/api/
  public_nodejs/      live version (forever runs it)
  public_nodejs_new/  being installed during a deploy
  releases/           previous versions, with node_modules (3 newest kept)
  shared/.env         PORT=..., NODE_ENV=production (chmod 600), copied into every release
  logs/               forever.log, out.log, err.log

~/apps/subtracker/backups/   (drwx------) api database dumps before each deploy,
                             <YYYYmmdd-HHMMSS>_<sha7>.dump (-rw-------), 10 newest kept,
                             none older than 180 days (see Backups and deleted accounts)

~/apps/subtracker/watchdog/  (drwx------) the watchdog's state.json: failure counts and the
                             time of the last mail, outside the releases so a deploy keeps it
```

`shared/.env` of the api also holds the database, CORS, session cookie and mail settings (template: `backend-subtracker/.env.example`, local copy `backend-subtracker/.env.mydevil`):

```
MODE=PROD
PORT=<PORT_API>
NODE_ENV=production
POSTGRES_HOST=...          # from `devil pgsql db add`; no POSTGRES_DATABASE_DEV
POSTGRES_PORT=5432
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=...
DATABASE_AUTO_SYNCHRONIZATION=false   # true is rejected at startup in PROD
CORS_ORIGINS=https://<frontend-domain>
FRONTEND_URL=https://<frontend-domain>   # bare https origin, target of the magic links
SESSION_COOKIE_DOMAIN=.<parent-domain>
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false                     # false = STARTTLS on 587, true = TLS on 465
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_FROM_EMAIL=...
SMTP_FROM_NAME=SubTracker
NOTIFICATION_ADMINISTRATOR_MAIL=...
SUPPORT_EMAIL=...                     # contact shown to a blocked account (message and mail)
LOG_ERROR_STACKS=true                 # optional, default true; false hides stack traces in error logs
```

The app and the migrations validate these settings at startup, so a missing or inconsistent key stops the deploy at the migration step and the previous version starts again. In `MODE=PROD`:

- `FRONTEND_URL`, `SESSION_COOKIE_DOMAIN`, `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `NOTIFICATION_ADMINISTRATOR_MAIL` and `SUPPORT_EMAIL` are required. Add `SUPPORT_EMAIL` (since S-09) to `shared/.env` **before** the first deploy that needs it: the migration CLI in `deploy.sh` checks it too, so without it the deploy rolls back at the migration step.
- `CORS_ORIGINS` must include `FRONTEND_URL`.
- `SESSION_COOKIE_DOMAIN` must cover the `FRONTEND_URL` host.
- `NOTIFICATION_SMTP_HOST`, `NOTIFICATION_SMTP_USERNAME`, `NOTIFICATION_SMTP_PASSWORD` and `NOTIFICATION_SMTP_FROM_EMAIL` are required (since S-12): a separate mailbox used only for operator alerts, with a login different from `SMTP_USERNAME` (the same MyDevil host is fine). A blocked or failing user mailbox then cannot silence the alerts. Without these keys, or with the same login, neither `migration:run` in `deploy.sh` nor the api start passes (the deploy rolls back), and the role scripts and the watchdog fail. Check the channel with the test script (below, "Alert channel test").

The scripts source this file with `sh` (`. .env`) and export it, so the app gets whatever `sh` made of each line. Keep values plain or in single quotes (`KEY='two words'`); never leave `$`, `` ` ``, `"`, `\` or `#` unquoted. Use letters and digits for passwords (`openssl rand -hex 16`). The keys must not repeat: `deploy.sh` reads `PORT` with `sed` and a second `PORT=` line breaks the health check.

Domains are MyDevil proxy domains, and TLS terminates on MyDevil:

- `<frontend-domain>` → `localhost:<PORT_FE>`
- `<api-domain>` → `localhost:<PORT_API>`

### Scripts

| Script | Purpose |
|---|---|
| `ci-gate.sh` | Forced command for the CI key. It accepts only `deploy <frontend\|api> <sha>`. |
| `deploy.sh <app> <sha>` | Unpacks the tarball from stdin into `public_nodejs_new`, runs `npm24 ci --omit=dev`, swaps it in with `mv`, and runs a health check (`/health` for the api, `/` for the frontend). For the api it first stops the live version, backs up the database and runs migrations (see [Database](#database)). If the health check fails, it restores the previous version automatically. |
| `restore-db.sh <file.dump>` | Restores the api database from a backup: first dumps the current state to `backups/<time>_pre-restore.dump` (10 kept), then drops and recreates the `public` schema and restores the dump, in one transaction. After a successful restore it runs `prune-backups.sh`. Does not stop or start the api. |
| `prune-backups.sh [file-to-keep]` | Deletes api dumps older than 180 days from `backups/`, but first takes a fresh `<time>_scheduled.dump` when no dump is younger than 30 days. Run daily from crontab and by `deploy.sh` (api) and `restore-db.sh`. See [Backups and deleted accounts](#backups-and-deleted-accounts). |
| `stop-app.sh <app>` | Stops the app: `forever stop` capped at 30 s, then the forever monitor and the app are killed by their path. `forever stop` can hang for good while the app is crash-looping. Every other script stops apps through it. |
| `start-app.sh <app>` | Restarts the app under `forever` on `/usr/local/bin/node24`, using the env from `.env`. Entry: `app.mjs` (frontend) / `app.js` (api), since MyDevil starts only these names. |
| `rollback.sh <app> [--yes]` | Makes the newest entry in `releases/` live again. For the api it also restores the database from the backup taken before the rolled-back release (asks for `TAK`). The frontend rolls back code only. Ends with a health check. |
| `start-all.sh` | Starts both apps after a reboot. |
| `watchdog.sh` | Every 5 minutes from crontab, checks the api (`/health`, including the state of the jobs) and the frontend (`/`) on `localhost` and mails the operator when one is down. Silent during a deploy, rollback or restore. See [Watchdog: operator alerts](#watchdog-operator-alerts). |

### Database

PostgreSQL on the server is version 16.10. Migrations use `gen_random_uuid()`, which needs version 13 or newer.

The api deploy is a deliberate step with a short downtime (about 30–60 s), in this order:

1. The new version is installed next to the live one (`npm24 ci`).
2. The live api is stopped. From now on nothing writes to the database.
3. `pg_dump -Fc` writes `~/apps/subtracker/backups/<time>_<sha7>.dump`.
4. `migration:run` from the new release, the whole batch in one transaction.
5. `.deploy-info` (`SHA`, `BACKUP`) is written into the new release, the versions are swapped, the new one starts and must pass the health check on `/health`, which queries the database.

Failure paths:

- **Backup or migration fails**: the old version starts again and the deploy stops. A failed migration batch is rolled back by PostgreSQL, so the database is as it was.
- **Health check fails after the migrations**: the new version is stopped, the database is restored from the backup of step 3, and the previous version starts again. If that restore fails, the deploy fails loudly and the api stays stopped: running old code on a mismatched schema is worse than downtime.
- `public_nodejs_new` (or `releases/<time>_failed`) stays for diagnosis.

Restoring by hand, e.g. when a problem shows up hours after a deploy:

```
~/apps/subtracker/bin/stop-app.sh api
~/apps/subtracker/bin/restore-db.sh ~/apps/subtracker/backups/<time>_<sha7>.dump
~/apps/subtracker/bin/start-app.sh api
```

`rollback.sh api` does this together with the code: it restores the backup listed in the live release's `.deploy-info`, i.e. the database from right before that release was deployed, then makes the previous release live. **Data written since that deploy disappears from the live database.** `restore-db.sh` keeps it in `backups/<time>_pre-restore.dump`, so a mistaken rollback can be undone by restoring that file (stop the api first). A release deployed before the backups existed has no `.deploy-info`, and the rollback refuses to run.

Releases in `releases/` are named `<time>_<sha7>` after the SHA they contain (`.deploy-info`); failed deploys end in `_failed`, rolled-back ones in `_rolledback`. Deploy, rollback and a manual restore of one app take a lock (`~/apps/subtracker/<app>/.ops.lock`), so they never overlap; the frontend and the api can still deploy at the same time. A lock left behind by a killed process is removed with `rmdir`.

**Deployed version and logs.** At start, both apps read `SHA` from their release's `.deploy-info` (never `BACKUP`); without the file they report `dev`. There are two ways to check the deployed version: `curl -s localhost:<PORT_API>/health` returns a `"version":"<sha>"` field (in the 503 answer too), and each app's `logs/out.log` gets a `Started <APPLICATION_NAME> version <sha> on port …` (api) or `Started subtracker-frontend version <sha> on port …` line at start. Lines of both apps have the format `[<app>] <pid>  - <ISO time in Europe/Warsaw with offset> <LEVEL> [<context>] <message>`, with no ANSI colour codes (colours appear only in a terminal). Every request leaves one `[Access]` line in `out.log`: in the api `<METHOD> <route template|(unrouted)> <status|aborted> <ms> ms user=<uuid|-> req=<uuid>`, in the frontend `<METHOD> <path> <status|aborted> <ms> ms` (static files skipped). None of them carries the query or tokens; the api line carries no address either (only the route template), while the frontend writes the path as the client sent it, so an address typed into the path by hand (e.g. `/sign-in/anna@example.com`) reaches `out.log` (the app's own links never put an address in the path; addresses travel only in the dropped `?q=`); requests from the watchdog and the deploy health checks are logged too.

Never run `migration:revert` in production: `down()` methods are unreliable. Going back is always a restore from a backup.

**Scheduled jobs.** The api runs its jobs (subscription lifecycle: trials ending, cancellations completing, billing dates moving forward; cleanup of sign-in tokens and sessions older than 7 days) once at every start, before it takes requests, and then daily at 00:05 Europe/Warsaw. None of this needs a manual step: whatever was missed while the api was stopped (a deploy across midnight, a restart by MyDevil, a reboot) is caught up by the next start, and a second run on the same day changes nothing. After a rollback or a manual restore from a dump, the database is back to its state from before the deploy, and the next start of a version that has the jobs repeats the transitions by itself. A release from before the jobs existed does not run them, so after rolling back to it dates stay as restored until a newer version starts. Every run (the trial reminders at 02:00 too) writes a row to the `job_run` table and one summary line to the log. A failed run (`failed`) or a partial one (`partial`, e.g. some users not reminded) goes to `logs/err.log` and sends a mail to `NOTIFICATION_ADMINISTRATOR_MAIL` (subject `SubTracker: zadanie <job> — <outcome>`), but does not fail the start or the health check. `GET /health` reports each job's state in its `jobs` field (`ok`, `stale` = no finished run in 26 h, `failed`); the status code depends on the database only. An uncaught exception in the process leaves one `Fatal ...` line in `err.log` and ends the process, and `forever` starts it again.

### Backups and deleted accounts

A user can delete their account in the app (`/account`). The deletion is immediate and final in the live database: the account and all its data are gone. Copies of the database still hold that data until they are deleted, so their age is limited.

- **Dumps live at most 180 days.** `backups/` holds the dumps taken before each api deploy (`<time>_<sha7>.dump`, 10 newest kept), before each restore (`<time>_pre-restore.dump`, 10 newest kept) and the scheduled ones (`<time>_scheduled.dump`, rotated together with the deploy dumps). On top of the count, `prune-backups.sh` deletes every dump older than 180 days. It runs daily from crontab (see [One-time setup](#one-time-setup)), after every api deploy and after every successful restore (which passes the restored dump so it is never deleted).
- **There is always a copy no older than a month.** Before deleting anything, `prune-backups.sh` checks for a dump younger than 30 days. If there is none (e.g. a month without a deploy), it first takes a fresh `<time>_scheduled.dump` and deletes only after that succeeded. Pruning never leaves `backups/` empty.
- **A failed dump deletes nothing.** The script exits 1 and the cron log `~/apps/subtracker/api/logs/prune-backups.log` says `database backup FAILED; nothing deleted` (after a deploy or restore the message is in their output instead; the deploy or restore itself still counts as successful). Fix the cause (usually the database settings in `shared/.env`) and run `~/apps/subtracker/bin/prune-backups.sh` by hand. If a deploy, rollback or restore is running, the cron run does nothing and exits 0; that operation prunes by itself.
- **Rollback of an old release may be refused.** `rollback.sh api` needs the dump listed in the release's `.deploy-info`. Once it is older than 180 days it is gone, and the rollback stops with `backup ... not found; nothing changed`. To recover after a failure, restore the newest dump with `restore-db.sh` (see [Database](#database)).
- **MyDevil's own daily backup** of the account has a retention we do not control. It is outside this rule.
- **A restore or rollback brings back deleted accounts.** Every account deleted after the dump was taken is in the restored database again. After a restore, delete those accounts again (the operator has to know which ones, e.g. from the users' requests).
- **The mail archive is anonymised.** Deleting an account keeps its rows in the `mail` table (type, status, dates) but replaces the address with `zanonimizowano@anonymized.invalid` and clears the error message. Mail goes only to addresses that still have an account.

What the full privacy policy has to say about this (it is written separately, before the public launch):

- deleting the account removes the data from the live database at once;
- database backups keep the data for up to 180 days, then they are deleted; MyDevil's own backup has its own retention;
- after restoring a backup, deletions made since then are repeated;
- the record of sent mail stays without the address.

### Granting and revoking roles (ADMIN, SUPER_ADMIN)

Roles are granted and revoked only by a script on the server (there is no role API), once the account exists, i.e. after the user has registered. `npm run admin:grant` and the other `npm run` role scripts are for local use only: `prepare-mydevil.mjs` flattens `dist/` into the package root, so the scripts live in `cli/`. The `.js` files are not run directly (`cli/superadmin-grant.js <mail>` ends with `Permission denied`): `node24` runs them from the live release with its env exported, the same way `deploy.sh` runs the migrations.

| Goal | Script |
| --- | --- |
| grant `ADMIN` (manages ordinary users) | `cli/admin-grant.js` |
| revoke `ADMIN` | `cli/admin-revoke.js` |
| grant `SUPER_ADMIN` (one, also manages admins) | `cli/superadmin-grant.js` |
| revoke `SUPER_ADMIN` | `cli/superadmin-revoke.js` |

```
cd ~/apps/subtracker/api/public_nodejs
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/admin-grant.js "$1"' sh <mail>
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/admin-revoke.js "$1"' sh <mail>
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/superadmin-grant.js "$1"' sh <mail>
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/superadmin-revoke.js "$1"' sh <mail>
```

Success prints one line with the role, the action and the address. Granting or revoking twice is harmless. An unknown address prints an error and exits with code 1. There is one superadmin at most: while another account holds the role, `superadmin-grant.js` exits 1 with "Superadmin już istnieje", so run `superadmin-revoke.js` for the previous one first. A role change takes effect from the account's next request, without signing it out (a page refresh is enough in the browser).

### Updating the scripts on the server

The scripts are **not** deployed by GitHub Actions: the workflows only ship app packages, and changes under `deploy/` don't trigger them. After changing any script here, upload it by hand.

1. Locally, from the repo root (PowerShell or Git Bash). List the files explicitly, because PowerShell doesn't expand `*.sh` for `scp`:

   ```
   scp deploy/mydevil/ci-gate.sh deploy/mydevil/deploy.sh deploy/mydevil/restore-db.sh deploy/mydevil/stop-app.sh deploy/mydevil/start-app.sh deploy/mydevil/rollback.sh deploy/mydevil/start-all.sh deploy/mydevil/prune-backups.sh deploy/mydevil/watchdog.sh <login>@s<N>.mydevil.net:~/apps/subtracker/bin/
   ```

   You can upload a single changed file the same way, for example only `deploy/mydevil/start-app.sh`.

2. On the server (after `ssh <login>@s<N>.mydevil.net`, not in the local terminal; or in one go with `ssh <login>@s<N>.mydevil.net '<commands>'`):

   ```
   chmod 700 ~/apps/subtracker/bin/*.sh
   ls -l ~/apps/subtracker/bin
   sha256 ~/apps/subtracker/bin/*.sh
   SSH_ORIGINAL_COMMAND="ls" ~/apps/subtracker/bin/ci-gate.sh
   ```

   Expected result: every script shows `-rwx------`, and the last command prints `ci-gate: rejected command: ls`. The checksums must match the repo: locally run `sha256sum deploy/mydevil/*.sh` (Git Bash) on the commit you uploaded from. Compare **all** scripts, not only the ones you changed: the server copy is updated by hand and can drift. A mismatch usually means CRLF line endings, which `.gitattributes` prevents for `*.sh`, or a forgotten upload. On FreeBSD the command is `sha256`, not `sha256sum`.

3. If you changed `start-app.sh`, apply it to the running processes:

   ```
   ~/apps/subtracker/bin/start-app.sh api
   ~/apps/subtracker/bin/start-app.sh frontend
   forever list
   ```

   Changes to `deploy.sh` and `ci-gate.sh` take effect with the next deploy. Changes to `stop-app.sh`, `restore-db.sh`, `rollback.sh`, `start-all.sh`, `prune-backups.sh` and `watchdog.sh` take effect the next time they run.

Local trial of `prune-backups.sh` before uploading: `sh dev-local/prune-backups-trial.sh` (see [`dev-local/README.md`](../../dev-local/README.md)).

### Watchdog: operator alerts

`watchdog.sh` (since S-11), run from crontab every 5 minutes, makes sure the operator learns about an outage from a mail rather than from a user. The script only prepares the environment: it reads `PORT` from `api/public_nodejs/.env` and `frontend/public_nodejs/.env` (the frontend file is read as text, never executed), then runs `/usr/local/bin/node24 cli/watchdog.js` from the live api release with the api's `.env` exported. The policy and the mail texts live in the api package (`src/watchdog/`), so they change with an api deploy.

Targets checked:

- **api**: `GET localhost:<PORT_API>/health` answers 2xx with `status: ok`;
- **frontend**: `GET localhost:<PORT_FE>/` answers 2xx;
- **jobs**: the `jobs` field of `/health`. A failure when any job is `stale` (no finished run in 26 h) or when `/health` answers 200 without a valid `jobs` field. `failed` jobs are mailed by the api itself; the watchdog does not repeat them. While the api is down, the `jobs` target is not judged.

Mail goes to `NOTIFICATION_ADMINISTRATOR_MAIL` through the operator transport (`NOTIFICATION_SMTP_*`), without the database: no row is written to the `mail` table. For each target:

- after 3 consecutive failures (about 15 minutes): `SubTracker: API nie odpowiada`, `SubTracker: Frontend nie odpowiada` or `SubTracker: zadanie cykliczne nie ruszyło od 26 h` (`... stan zadań cyklicznych nieczytelny` when the `jobs` field is missing); when the API answers but `/health` reports the database (503, `db: error`), the subject is `SubTracker: API bez bazy danych` (the subject describes the check that sends the mail, so a reminder may name a different cause than the first alert);
- while the target stays down, a reminder every 12 h (`... nadal ...`);
- once it is back, one `... działa ponownie` mail.

A mail that could not be sent leaves the alert state unchanged, so the next run tries again. The state lives in `~/apps/subtracker/watchdog/state.json` (written atomically, outside the releases). The log `~/apps/subtracker/api/logs/watchdog.log` gets a line only for a mail (sent or not), a skipped run or an error of the watchdog itself; a quiet run writes nothing.

During a deploy, rollback or restore (`api/.ops.lock` or `frontend/.ops.lock` younger than 30 minutes) the run is skipped with exit code 0, so a normal deploy raises no alert. An older lock (left by a killed process) does not silence the watchdog: every run logs it until you remove it with `rmdir`. Exit code 1 means the watchdog cannot run (no `.env`, no `PORT`, invalid api env); it then sends no mail, and the cause is in the log.

One run at a time: the watchdog takes the lock `~/apps/subtracker/watchdog/.run.lock`, and while the previous run is still going it exits 0 with a log line. A run is stopped after 240 s (`timeout`, exit code 124 with a log line), so a lock older than 15 minutes was left by a run killed before it could clean up (SIGKILL, a server restart): the next run takes it over and logs it; there is no need to remove it by hand. When the lock cannot be created for another reason (permissions, a full disk), the run exits 1.

**Installing** (once, after an api deploy that contains `cli/watchdog.js`):

1. Upload `watchdog.sh` and check it like the other scripts: `scp`, `chmod 700`, `sha256` compared with the repo (see [Updating the scripts on the server](#updating-the-scripts-on-the-server)).
2. On the server, check that the api reports its jobs and run the watchdog once by hand:

   ```
   curl -s localhost:<PORT_API>/health
   ~/apps/subtracker/bin/watchdog.sh; echo "exit $?"
   cat ~/apps/subtracker/watchdog/state.json
   ```

   Expected result: `/health` contains `"jobs"` with `ok` for the three jobs, the watchdog prints nothing and ends with `exit 0`, no mail arrives, and `state.json` has `"failures": 0` for `api`, `frontend` and `jobs`.
3. Add the watchdog line to crontab (see [One-time setup](#one-time-setup)).

**Silencing it:** comment out the watchdog line in crontab (`crontab -e`, `#` at the start). Once it is back, the watchdog continues from the stored state: a target that was alerted and works again gets the recovery mail. Deleting `state.json` resets the counts (without a recovery mail).

**Limits:**

- It checks `localhost` only, like the `deploy.sh` health check. A failure of the MyDevil proxy, DNS or TLS is invisible to it.
- It runs from the api release: a broken api package (no `cli/watchdog.js`, a bad `.env`) disables the watchdog too. The only trace is in `watchdog.log`.
- Alerts use a separate mailbox, but the same MyDevil mail service as user mail. An outage of the whole MyDevil mail service silences the alerts too; the trace stays in `watchdog.log` (an accepted limitation).

**Alert channel test.** After an api deploy, after changing the alert mailbox password, or when alerts stop arriving: `cd ~/apps/subtracker/api/public_nodejs && node cli/operator-test-mail.js; echo "exit $?"`. The script prints which channel it uses (`operator channel: separate (<sender>)`) and sends one mail `SubTracker: test kanału alarmów` to `NOTIFICATION_ADMINISTRATOR_MAIL`. `exit 0` means the mail server accepted it; `exit 1` is a bad `.env`, a missing operator address or a refusal (the line holds only the SMTP code and enhanced status, no address). Locally: `npm run operator:test-mail` in `backend-subtracker/` (in DEV without `NOTIFICATION_SMTP_HOST` the line says `shared with SMTP_* (DEV)`, so the separate mailbox was not tested).

**Alert about a failed mail.** When the api cannot send a mail to a user, it mails the operator `SubTracker: nieudana wysyłka maila` with the audit row id, the mail type and the number of failures skipped since the previous alert. Each mail type has its own window: after an accepted alert the next one of that type comes at the earliest 15 minutes later, after a failed one it is retried at the earliest a minute later. Failures during the window reach the operator as a count only in the next alert of that type; if nothing fails afterwards, they stay only in `err.log` and the `mail` table. A refusal of the recipient's address as unknown or wrong (SMTP status 5.1.1, 5.1.2, 5.1.3, 5.1.6, 5.1.10) is the user's typo: only a `warn` line in `out.log`, no alert. Any other refusal (e.g. 5.1.7 and 5.1.8 for a bad sender, 5.7.1 on relay, a sending limit, SPF/DMARC) alerts, and the `err.log` line gives the SMTP code and status.

Local trial before uploading or after changing `src/watchdog/`: `dev-local/watchdog-trial.mjs` (see [`dev-local/README.md`](../../dev-local/README.md)).

### One-time setup

`authorized_keys` entry for the GitHub Actions key. Use an absolute path:

```
command="/usr/home/<login>/apps/subtracker/bin/ci-gate.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-actions-subtracker
```

crontab:

```
@reboot /usr/home/<login>/apps/subtracker/bin/start-all.sh >> /usr/home/<login>/apps/subtracker/api/logs/start-all.log 2>&1
0 4 * * 0 find /usr/home/<login>/apps/subtracker/*/logs -name '*.log' -size +20M -exec truncate -s 0 {} \;
30 4 * * * /usr/home/<login>/apps/subtracker/bin/prune-backups.sh >> /usr/home/<login>/apps/subtracker/api/logs/prune-backups.log 2>&1
*/5 * * * * /usr/home/<login>/apps/subtracker/bin/watchdog.sh >> /usr/home/<login>/apps/subtracker/api/logs/watchdog.log 2>&1
```

Replace every `<login>` with the account name before pasting. cron runs each line through `/bin/sh`, which reads `<login>` as a redirect from a file named `login`: the line fails with `cannot open login: No such file or directory` before the script starts, and the error lands only in the local mailbox `/var/mail/<login>`. After saving, check `crontab -l | grep '<login>'` (it should print nothing).

The `prune-backups.sh` line deletes database dumps older than 180 days every day, also without deploys (see [Backups and deleted accounts](#backups-and-deleted-accounts)). Run it once by hand after adding it; it should end with `done: <n> dump(s) deleted`. The `watchdog.sh` line checks the api and the frontend every 5 minutes (see [Watchdog: operator alerts](#watchdog-operator-alerts)); run it once by hand before adding it.

The scripts expect `forever` on `PATH`. They look in `/usr/local/bin` and `~/.npm-global/bin`. If yours lives elsewhere, adjust the `PATH` line at the top of each script.

Other apps run under `forever` on this account. Stop SubTracker processes with `stop-app.sh <app>` (by uid, with a fallback kill by path), never with `forever stopall`. The scripts need `timeout` and `pkill`, both in FreeBSD's base system.
