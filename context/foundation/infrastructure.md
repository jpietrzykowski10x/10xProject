---
project: SubTracker
researched_at: 2026-10-02
recommended_platform: MyDevil (MD1, istniejące konto)
runner_up: Render
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Angular 22 (SSR, @angular/ssr + Express 5) + NestJS 12
  runtime: Node 24 (/usr/local/bin/node24 na MyDevil)
---

## Recommendation

**Deploy on MyDevil** — na istniejącym koncie użytkownika, jako dwa własne procesy Node 24 (`forever`, porty z `devil port add`, domeny typu `proxy`), bez Passengera.

MyDevil przegrywa z PaaS-ami na kryteriach agent-friendly (brak API/MCP, brak wbudowanego rollbacku, SSH = pełny dostęp do konta), ale wygrywa na wszystkich wagach z wywiadu: koszt krańcowy 0 zł (konto już opłacone — wywiad: „bezkosztowo lub tanio”), jedyna platforma, którą deweloper zna (wywiad: brak doświadczenia z PaaS), serwerownia w Warszawie (wywiad: jeden region — Polska) oraz Postgres z codziennym backupem i poczta SMTP w pakiecie (wywiad: współlokacja „fajnie, jeśli będzie”). Stale działający proces dla `@nestjs/schedule` (wywiad: tak) jest spełniony przez `forever` + `@reboot` — bez usypiania. Decyzja jest świadoma: luki operacyjne zamykamy w workflow deployu (patrz Risk Register), a Render pozostaje gotowym planem B.

## Platform Comparison

Filtry twarde: wymagany stale działający proces (scheduler w procesie NestJS) oraz Node 24 dla Angular SSR + NestJS/TypeORM/pg.

| Platforma | CLI-first | Managed | Docs dla agenta | Stabilny deploy API | MCP | Koszt/mies. (MVP) | Wynik |
|---|---|---|---|---|---|---|---|
| Netlify | — | — | — | — | — | — | **odpada** (brak procesu stałego) |
| Vercel | — | — | — | — | — | — | **odpada** (brak procesu stałego) |
| Cloudflare | — | — | — | — | — | — | **odpada** (NestJS/TypeORM nie działa w Workers) |
| Render | Partial | Pass | Pass | Pass | Pass | ~20 USD | 1. wg kryteriów |
| Railway | Partial | Pass | Pass | Partial | Partial (beta) | ~5–8 USD | 2. wg kryteriów |
| Fly.io | Pass | Partial | Pass | Pass | Pass | ~45–50 USD | 3. wg kryteriów, karany kosztem |
| MyDevil | Partial | Fail | Partial | Fail | Fail | 0 zł (istniejące konto) | ostatni wg kryteriów, **1. po wagach z wywiadu i decyzji użytkownika** |

Notatki (stan na 2026-10-02):

- **Netlify** — Angular 22 SSR wspierany od dnia premiery (`@netlify/angular-runtime` v4), ale NestJS tylko jako jedna funkcja (cold start całego DI + TypeORM), Scheduled Functions max 30 s, funkcje domyślnie w Ohio (region EU tylko na Pro). Nie spełnia filtra procesu stałego.
- **Vercel** — NestJS zero-config (Fluid compute, GA), ale Angular SSR wymaga ręcznego `api/index.js` + rewrites; brak procesu stałego (cron na Hobby raz dziennie ±59 min); Hobby zabrania użytku komercyjnego. MCP — public beta.
- **Cloudflare** — Angular SSR możliwy po przepisaniu `server.ts` na fetch handler; NestJS + TypeORM w Workers: problemy z bundlowaniem, 128 MB, 10 ms CPU na Free. Containers (GA od 2026-04-13) wymagają planu 5 USD i usypiają po `inactivityTimeout` — scheduler w procesie nie działa. Brak Postgresa (tylko przez Hyperdrive). Email Sending — public beta.
- **Render** — Node 24 domyślny, `render.yaml` z `rootDir` per usługa, region Frankfurt, zarządzany Postgres, MCP GA (od 07.2026), `llms.txt`. Rollback tylko w panelu lub przez API (CLI bez rollbacku). Darmowy plan usypia po 15 min i darmowy Postgres wygasa po 30 dniach — realnie trzeba ~20 USD/mies. Zmiany cennika z 22/28.08.2026 niezweryfikowane.
- **Railway** — Railpack z pinowaniem Node 24, root directory per usługa, region Amsterdam, ~5–8 USD/mies. na Hobby. Postgres „unmanaged”, natywne backupy prawdopodobnie tylko na Pro, rollback tylko z panelu i tylko gdy obraz jest zachowany (72 h na Hobby). MCP — beta.
- **Fly.io** — najlepsze CLI (`fly deploy`, `fly logs`, `fly mcp server`), ale brak darmowego planu dla nowych organizacji, region Warszawa zlikwidowany (najbliżej `fra`), Managed Postgres od 38 USD/mies., niezarządzany Postgres wycofywany; ceny maszyn podniesione 2026-10-01.
- **MyDevil** — Node v16–v26 jako osobne binaria (`node24`, `npm24`), CLI `devil` (www, ssl, pgsql, port, binexec, dns, mail) dostępne tylko przez SSH i bez wyjścia JSON, dokumentacja jako polska MediaWiki (pomoc.mydevil.net, brak `llms.txt`, jest `api.php`), brak REST API/MCP, brak rollbacku, serwerownia ATMAN Warszawa (SLA 99,7%), nielimitowane bazy PostgreSQL z codziennym backupem, Let's Encrypt przez `devil ssl`. Moduły natywne trzeba budować na FreeBSD (`npm ci` na serwerze).

### Shortlisted Platforms

#### 1. MyDevil (Recommended — decyzja użytkownika)

Zerowy koszt krańcowy, znane środowisko, Warszawa, Postgres + backup + SMTP w pakiecie, stały proces przez `forever` + `@reboot` (bez wybudzania). Najsłabszy wynik na kryteriach agent-friendly — luki (deploy atomowy, rollback, zawężony dostęp agenta, obserwowalność) zostają zamknięte własnym workflow i skryptami, co jest kosztem jednorazowym (~1 wieczór).

#### 2. Render (Runner-up)

Najlepszy wynik wg kryteriów: zarządzany Postgres, deklaratywny `render.yaml`, rollback przez API, MCP GA, Frankfurt. Przegrywa ceną (~20 USD/mies. wobec 0 zł) i brakiem znajomości. Pełni rolę planu B — nie dlatego, że MyDevil wymaga wybudzania (nie wymaga), tylko na wypadek, gdy: wspólne konto z prywatnymi stronami zacznie ograniczać (RAM / procesy / izolacja danych finansowych), utrzymanie deployu zacznie zjadać budżet 8 h/tydz. albo potrzebny będzie zawężony dostęp agenta (tokeny, MCP).

#### 3. Railway

Najtańszy PaaS (~5–8 USD/mies.), region Amsterdam, stałe kontenery. Przegrywa z Render brakiem backupów bazy na Hobby, rollbackiem tylko z panelu i MCP w becie.

## Anti-Bias Cross-Check: MyDevil

Uwzględnione założenia użytkownika: konto już opłacone (0 zł), cron działa, aplikacje uruchamiane przez `forever` jako własne procesy na zarezerwowanych portach (bez Passengera — więc bez wyłączania po 24 h bezczynności).

### Devil's Advocate — Weaknesses

1. **Wspólne konto = wspólne limity i promień rażenia.** SubTracker dzieli z prywatnymi stronami 1 GB RAM (MD1), limit 40 procesów i jednego użytkownika uniksowego. SSR (~150–250 MB) + NestJS/TypeORM (~150–250 MB) + `npm ci` na serwerze w trakcie deployu mogą przekroczyć limit i ubić procesy — także prywatne. Kompromitacja SubTrackera daje dostęp do wszystkich stron na koncie, a w bazie leżą dane finansowe użytkowników.
2. **Agent dostaje klucz główny.** Brak API, tokenów o zawężonym zakresie i MCP — każda operacja agenta/CI to SSH z pełną powłoką na całe konto, wbrew zasadzie minimalnych uprawnień.
3. **Brak rollbacku i nieatomowy deploy.** `rsync` w miejscu + kilkuminutowe `npm ci` oznacza, że działający proces może widzieć pół starego, pół nowego kodu. Rollback trzeba zbudować samemu; migracje TypeORM i tak się nie cofną.
4. **`forever` jest praktycznie porzucony.** Brak rotacji logów, pętla awarii kończy się zatrzymaniem procesu po limicie restartów bez żadnego sygnału.
5. **Zero obserwowalności.** Brak metryk i alertów — o awarii backendu (i niewysłanych przypomnieniach o trialu) dowiadujemy się od użytkownika.

### Pre-Mortem — How This Could Fail

Deploy z GitHub Actions działał kilka tygodni. Potem merge uruchomił `npm ci` w ciągu dnia; proces NestJS doczytał w połowie podmieniony `dist/`, wywalił się, a `forever` po kilku restartach przestał próbować. Nikt nie dostał alertu, przypomnienia o końcu triala — rdzeń obietnicy produktu — nie wychodziły przez trzy dni. Przy naprawie wyszło, że `@reboot` w crontabie startował `forever` domyślnym Node 22, bo cron ma okrojony PATH; po restarcie serwera MyDevil backend wstawał na złej wersji, a SSR Angulara 22 nie startował wcale. Klucz SSH z sekretów GitHuba dawał pełny dostęp do konta z prywatnymi stronami; agent poproszony o „posprzątanie starych buildów” usunął katalog innej domeny. Rollbacku nie było, więc przywracano z dziennego backupu MyDevil, tracąc dzień danych. W międzyczasie logi `forever` zapełniły dysk, bo nikt ich nie rotował.

### Unknown Unknowns

- **Wersja Node w `forever` i `@reboot`.** Domyślny `node` na MyDevil to v22; Angular 22 wymaga Node ≥ 22.22.3 / 24.15. Trzeba jawnie `forever start -c /usr/local/bin/node24 …` i `npm24 ci`, z pełnymi ścieżkami w crontabie.
- **Strefa czasowa schedulera.** `@nestjs/schedule` liczy wg strefy procesu — bez jawnego `timeZone: 'Europe/Warsaw'` (lub UTC w bazie) przypomnienie przy zmianie czasu przesunie się o godzinę albo wyjdzie dwukrotnie.
- **Klucz SSH da się zawęzić.** `command="~/apps/subtracker/bin/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding` w `authorized_keys` sprawia, że klucz CI uruchamia tylko skrypt deployu, bez powłoki.
- **Współdzielony Postgres (`pgsqlN.mydevil.net`).** Limity połączeń per konto nieudokumentowane — pula TypeORM powinna być mała (np. `extra: { max: 5 }`).
- **Poczta w pakiecie, ale dostarczalność to nie gwarancja.** Magic link i przypomnienia mogą iść przez SMTP MyDevil, lecz zależą od SPF/DKIM/DMARC domeny i reputacji współdzielonego IP — test z Gmailem przed startem.
- **Angular SSR sprawdza nagłówek Host** (od 20.3). Za proxy MyDevil trzeba ustawić `allowedHosts` / `NG_ALLOWED_HOSTS` na domenę frontendu, inaczej SSR po cichu spada do CSR.

## Operational Story

- **Preview deploys**: brak — MyDevil nie ma środowisk preview. Na MVP weryfikacja lokalna (`npm start` / `npm run start:dev`) + ewentualnie ręczna subdomena `staging.` z osobnym portem i bazą, jeśli zajdzie potrzeba.
- **Secrets**: klucz SSH deployu i host key w GitHub Secrets (`MYDEVIL_SSH_KEY`, `MYDEVIL_KNOWN_HOSTS`); zmienne runtime (`DATABASE_URL`, `SESSION_SECRET`, SMTP) w `~/apps/subtracker/<app>/shared/.env` z `chmod 600`, kopiowane do każdego wydania (paczka z CI nie zawiera sekretów). Rotacja ręczna: edycja `shared/.env` i `public_nodejs/.env` + `~/apps/subtracker/bin/start-app.sh <app>`.
- **Rollback**: automatyczny, gdy health-check po deployu zawiedzie; ręcznie `~/apps/subtracker/bin/rollback.sh api` (lub `frontend`) — przenosi najnowsze wydanie z `releases/` z powrotem na `public_nodejs` (z `node_modules`, bez `npm install`) i restartuje `forever`; czas ~10–30 s. Migracje bazy nie cofają się — muszą być wstecznie kompatybilne; ostateczność to dzienny backup Postgresa z MyDevil (utrata do 24 h danych).
- **Approval**: człowiek — merge do `main` (= deploy produkcyjny), zmiany `devil www/ssl/dns/pgsql`, rotacja `SESSION_SECRET`, usuwanie baz i katalogów domen, przywracanie backupu. Agent bez nadzoru — odczyt logów, `forever list`, `gh run view`, przygotowanie PR z poprawką workflow.
- **Logs**: pipeline — `gh run list --workflow deploy-backend.yml` / `gh run view <id> --log`; runtime — `tail -n 200 ~/apps/subtracker/api/logs/out.log ~/apps/subtracker/api/logs/err.log`, `forever list`; proxy — `~/domains/<domena>/logs/error.log`.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Nieatomowy deploy (nadpisywanie w miejscu + `npm ci`) psuje działający proces | Devil's advocate | H | H | Nowa wersja instalowana w `public_nodejs_new` obok działającej, zamiana dwoma `mv`, health-check z automatycznym powrotem (`deploy/mydevil/deploy.sh`) |
| Brak rollbacku | Devil's advocate | M | H | Poprzednie wersje w `releases/` razem z `node_modules`; `~/apps/subtracker/bin/rollback.sh <app>`; 3 ostatnie wydania |
| Migracja TypeORM nie cofa się z rollbackiem | Pre-mortem | M | H | Migracje tylko addytywne (expand/contract); w `deploy.sh` `pg_dump` + `migration:run` przed zamianą katalogów (błąd = stop, stara wersja nietknięta) |
| `forever`/`@reboot` startuje domyślnym Node 22 | Unknown unknowns | H | H | `forever start -c /usr/local/bin/node24`, pełne ścieżki w crontabie, `npm24` przy instalacji |
| Klucz SSH CI = pełny dostęp do konta z prywatnymi stronami | Devil's advocate | M | H | `command=".../bin/ci-gate.sh",no-pty,…` w `authorized_keys` (akceptuje tylko `deploy <app> <sha>`); osobny klucz dla agenta tylko do odczytu logów |
| Przekroczenie RAM/procesów wspólnego konta (MD1 1 GB) | Devil's advocate | M | M | `NODE_OPTIONS=--max-old-space-size=256` per proces, mała pula DB; dokupienie +1 GB (10 zł/mies.) lub migracja na Render |
| `forever` przestaje restartować, brak alertu | Pre-mortem | M | H | `forever --minUptime 5000 --spinSleepTime 10000`; zewnętrzny darmowy monitor HTTP na `/health` API i frontendu |
| Logi zapełniają dysk | Pre-mortem | M | M | Rotacja przez cron (`newsyslog`/skrypt z `truncate`) dla `~/apps/subtracker/*/logs` |
| Przypomnienia o trialu przesunięte przez DST / zgubione przy restarcie | Unknown unknowns | M | H | Jawne `timeZone: 'Europe/Warsaw'` w `@Cron`; idempotentne zapytanie o zaległe triale z flagą `reminder_sent_at` |
| Dostarczalność maili (magic link) przez współdzielone IP | Unknown unknowns | M | H | SPF/DKIM/DMARC na domenie, test z Gmailem; fallback na dostawcę z API HTTP |
| SSR spada do CSR przez sprawdzanie nagłówka Host | Unknown unknowns | M | M | `allowedHosts` / `NG_ALLOWED_HOSTS` z domeną frontendu |
| Moduły natywne bez builda na FreeBSD | Research finding | L | M | `npm24 ci --omit=dev` na serwerze (nigdy `node_modules` z Linuksa); unikać zależności z prebuildami tylko pod Linux |
| Brak API/MCP — agent operuje przez SSH bez JSON | Research finding | H | L | Skrypty `~/apps/subtracker/bin/*.sh` jako stabilny interfejs; aliasy SSH w `~/.ssh/config` |
| Regulamin dot. długo działających procesów nieznany (strona 404) | Research finding | L | M | Użytkownik już tak uruchamia aplikacje; w razie problemu — Render jako plan B |

## Getting Started

Zweryfikowane wobec: Angular 22.2 SSR (paczka `.mydevil/`: `app.mjs` + `public/`, `PORT`), NestJS 12 ESM (paczka `.mydevil/`: `app.js`; MyDevil uruchamia tylko `app.js`/`app.mjs`), Node 24 na MyDevil jako `/usr/local/bin/node24`.

Pełna procedura pierwszego wdrożenia: `context/deployment/deploy-plan.md`; skrypty serwerowe: `deploy/mydevil/`.

1. **Porty**: `devil port add tcp random` dwukrotnie — zanotuj porty dla frontendu i API.
2. **Domeny i TLS**: obie subdomeny jako proxy — `devil www add subtracker.jakubpietrzykowski.pl proxy localhost <PORT_FE>`, `devil www add apisubtracker.jakubpietrzykowski.pl proxy localhost <PORT_API>`, potem `devil ssl www add <IP z devil vhost list> le le <subdomena>` dla każdej. TLS kończy się na proxy — aplikacje słuchają HTTP na localhost, bez certyfikatów w kodzie. Baza (`devil pgsql db add subtracker`) — razem ze zmianą wprowadzającą TypeORM.
3. **Układ katalogów i skrypty**: `~/apps/subtracker/{frontend,api}/{releases,shared,logs}`, `shared/.env` (`PORT`, `NODE_ENV`; `chmod 600`), `deploy/mydevil/*.sh` skopiowane do `~/apps/subtracker/bin`.
4. **Procesy**: `~/apps/subtracker/bin/start-app.sh <app>` uruchamia `forever` z `-c /usr/local/bin/node24`; `@reboot ~/apps/subtracker/bin/start-all.sh` w crontabie (pełne ścieżki).
5. **CI**: `.github/workflows/deploy-{frontend,backend}.yml` (path filters per katalog) — build na Node 24, `npm run prepare-mydevil` → `.mydevil/`, `tar | ssh` kluczem z wymuszoną komendą `ci-gate.sh` → `deploy.sh` (`npm24 ci --omit=dev` w `public_nodejs_new`, zamiana `mv`, health-check).

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (szczegóły workflow — w planie deployu)
- Production-scale architecture (multi-region, HA, DR)
