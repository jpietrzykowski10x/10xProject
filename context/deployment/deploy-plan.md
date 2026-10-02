---
status: approved
approved_at: 2026-10-02
platform: MyDevil
---

# Pierwsze wdrożenie SubTracker na MyDevil (prepare-mydevil + GitHub Actions)

## Context

`context/foundation/infrastructure.md` wybrał MyDevil (istniejące konto, Node 24, `forever` + `@reboot`). Plan odwzorowuje sprawdzony proces użytkownika z poprzedniego projektu (`fyi/*-example-package.json`): skrypt `prepare-mydevil` buduje paczkę `.mydevil/` → wgranie na serwer → `npm install` → `forever`. Zmiany względem tamtego procesu:

- **paczkę buduje i wgrywa GitHub Actions** po merge na `main` (zgodnie z `tech-stack.md`), a nie ręczne wgrywanie;
- **sekrety (`.env`) nie jadą w paczce** — leżą na serwerze w `shared/` i są dokładane przy deployu;
- **wersjonowanie i rollback**: nowa wersja przygotowywana obok działającej (`public_nodejs_new`), zamiana przez `mv`, poprzednie wersje w `releases/` razem z `node_modules` (rollback = dwa `mv`, bez `npm install`); konfiguracja domen MyDevil nie zmienia się przy deployach;
- **obie subdomeny jako proxy na `localhost:<port>`**, TLS kończony na MyDevil (Let's Encrypt, auto-odnawianie) — NestJS działa po HTTP na localhost, bez certyfikatów w aplikacji. Przeglądarka widzi HTTPS po obu stronach, więc nie ma mixed content (powód, dla którego wcześniej Nest musiał serwować HTTPS sam).

Cel: obecne „hello world” obu aplikacji pod `https://subtracker.jakubpietrzykowski.pl` (Angular 22 SSR) i `https://apisubtracker.jakubpietrzykowski.pl` (NestJS 12 ESM). Agent **nie łączy się z MyDevil** — komendy serwerowe wykonuje użytkownik. Baza i migracje dochodzą w zmianie z TypeORM; tu tylko rezerwujemy na nie miejsce w skrypcie.

## Zmiany w repo (wykonuje agent)

1. **`frontend-subtracker/angular.json`** — `security.allowedHosts`: `["subtracker.jakubpietrzykowski.pl", "localhost"]` (Angular 20.3+ sprawdza Host; bez tego SSR spada do CSR).
2. **`frontend-subtracker/scripts/prepare-mydevil.mjs`** + skrypt `"prepare-mydevil": "ng build && node scripts/prepare-mydevil.mjs"` — czyści `.mydevil/`, spłaszcza `dist/frontend-subtracker/server/*` do katalogu głównego paczki z `server.mjs` → **`app.mjs`** (MyDevil uruchamia tylko `app.js`/`app.mjs`), `browser/` → `public/`, plus `package.json`, `package-lock.json`. `src/server.ts` szuka plików statycznych najpierw w `./public`, potem w `../browser` (układ `dist`). Czysty `node:fs` (`rm`, `cp`) zamiast `copyfiles`/`renamer`/`rimraf` — zero nowych zależności, działa na Windows i w CI.
3. **`backend-subtracker/scripts/prepare-mydevil.mjs`** + `"prepare-mydevil": "nest build && node scripts/prepare-mydevil.mjs"` — `.mydevil/` ze spłaszczonym `dist/*`, `main.js` → **`app.js`**, `package.json`, `package-lock.json` (ESM, `"type": "module"` jedzie w `package.json`). Później dojdą tu migracje i `data-source.js`.
4. **`.gitignore`** — `.mydevil/`.
5. **`deploy/mydevil/`** (POSIX `sh`, FreeBSD):
   - `ci-gate.sh` — wymuszona komenda klucza CI: akceptuje tylko `deploy <frontend|api> <40-znakowy sha>`, inaczej exit 1; przekazuje stdin do `deploy.sh`.
   - `deploy.sh <app> <sha>` — w `~/apps/subtracker-<app>/`:
     1. rozpakuj tarball ze stdin do świeżego `public_nodejs_new/`, skopiuj `shared/.env`;
     2. `/usr/local/bin/npm24 ci --omit=dev` w `public_nodejs_new` (stara wersja dalej działa — błąd tu nie dotyka produkcji);
     3. *(miejsce na przyszłość: `pg_dump` do `~/backups/` + `migration:run` — błąd = stop, stara wersja nietknięta)*;
     4. `forever stop` → `mv public_nodejs releases/<YYYYmmdd-HHMM>_<sha7>` → `mv public_nodejs_new public_nodejs` → `start-app.sh`;
     5. health-check `curl` na `localhost:$PORT` (3 próby); porażka → odwrotne `mv` + `start-app.sh` + exit 1;
     6. zostaw 3 ostatnie wydania.
   - `start-app.sh <app>` — `forever stop subtracker-<app>` (ignoruje błąd), `set -a; . public_nodejs/.env`, `forever start --uid subtracker-<app> -c /usr/local/bin/node24 --minUptime 5000 --spinSleepTime 10000 --workingDir … -a -l/-o/-e ~/apps/subtracker-<app>/logs/… <entry>` (frontend: `app.mjs`, api: `app.js`).
   - `rollback.sh <app>` — najnowsze wydanie z `releases/` wraca na `public_nodejs` (bieżące odkładane do `releases/` z dopiskiem `_failed`), `start-app.sh`.
   - `start-all.sh` — dla `@reboot`: PATH + `start-app.sh api` i `start-app.sh frontend`.
   - `README.md` — układ katalogów, wpis `authorized_keys`, crontab, ręczny rollback.
6. **`.github/workflows/deploy-backend.yml`** — `push` na `main` z `paths: backend-subtracker/**` + `workflow_dispatch`; `concurrency: deploy-backend`; Node 24 (`actions/setup-node`, cache npm); `npm ci`, `npm run lint`, `npm test`, `npm run prepare-mydevil`; `tar czf - -C .mydevil . | ssh … "deploy api $GITHUB_SHA"`.
7. **`.github/workflows/deploy-frontend.yml`** — analogicznie dla `frontend-subtracker/**` (bez lint/test — brak targetów), `deploy frontend $GITHUB_SHA`.
   - SSH: klucz z `secrets.MYDEVIL_SSH_KEY` (plik 600), `known_hosts` z `secrets.MYDEVIL_KNOWN_HOSTS`, `MYDEVIL_HOST`/`MYDEVIL_USER` z sekretów; bez `StrictHostKeyChecking=no`.
8. **`context/deployment/deploy-plan.md`** — kopia zatwierdzonego planu.
9. **`context/foundation/infrastructure.md`** — Getting Started/Operational Story zaktualizowane do: `prepare-mydevil`, `public_nodejs_new` + `mv`, `tar | ssh` z wymuszoną komendą, TLS na proxy.

## Bramki ręczne (użytkownik, w tej kolejności)

**A. Lokalnie (na własnym komputerze, NIE na MyDevil)** — `ssh-keygen -t ed25519 -f ~/.ssh/subtracker_deploy -N "" -C "github-actions-subtracker"` (Git Bash lub PowerShell). Powstają dwa pliki:
- `~/.ssh/subtracker_deploy` (prywatny) → wklejasz do GitHub Secret `MYDEVIL_SSH_KEY`; na serwer nie trafia nigdy;
- `~/.ssh/subtracker_deploy.pub` (publiczny) → dopisujesz na MyDevil do `~/.ssh/authorized_keys` z prefiksem `command=…` (krok B.7).
Po wklejeniu do GitHuba plik prywatny można usunąć z dysku — w razie potrzeby generuje się nowy.

**B. MyDevil (SSH własnym kluczem)**
1. `ls /usr/local/bin/node24 /usr/local/bin/npm24 && which forever curl`.
2. `devil port add tcp random` ×2 → `PORT_FE`, `PORT_API`.
3. `devil www add subtracker.jakubpietrzykowski.pl proxy localhost <PORT_FE>` i `devil www add apisubtracker.jakubpietrzykowski.pl proxy localhost <PORT_API>`; DNS A obu subdomen na IP z `devil vhost list public` (gdy strefa na MyDevil: `devil dns add jakubpietrzykowski.pl subtracker A <IP>`, analogicznie `apisubtracker`).
4. `devil ssl www add <IP> le le subtracker.jakubpietrzykowski.pl` i to samo dla `apisubtracker.…` (po propagacji DNS).
5. `mkdir -p ~/apps/subtracker-{frontend,api}/{releases,shared,logs} ~/bin`; `shared/.env` każdej aplikacji: `PORT=<…>`, `NODE_ENV=production`; `chmod 600`.
6. Skopiuj `deploy/mydevil/*.sh` do `~/bin`, `chmod 700`.
7. `~/.ssh/authorized_keys`: `command="/usr/home/<login>/bin/ci-gate.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… github-actions-subtracker`.
8. `crontab -e`: `@reboot /usr/home/<login>/bin/start-all.sh` oraz `0 4 * * 0 find /usr/home/<login>/apps/*/logs -name '*.log' -size +20M -exec truncate -s 0 {} \;`.

**C. GitHub → Settings → Secrets → Actions** — `MYDEVIL_HOST` (`sN.mydevil.net`), `MYDEVIL_USER`, `MYDEVIL_SSH_KEY`, `MYDEVIL_KNOWN_HOSTS` (`ssh-keyscan sN.mydevil.net`).

**D. Deploy** — przegląd i push na `main` (agent nie pushuje). Zmiana `angular.json`/`package.json` uruchomi oba workflowy; w razie potrzeby `workflow_dispatch`. Bramki B–C muszą być gotowe przed pushem.

## Wariant awaryjny (tylko gdy proxy dla API zawiedzie)

Backend serwuje HTTPS sam (jak w poprzednim projekcie), ale certyfikat i klucz czytane ze ścieżek w `shared/.env` (nie kopiowane do paczki — inaczej po odnowieniu Let's Encrypt aplikacja wystawi przeterminowany certyfikat) + cotygodniowy restart z crona. Nie implementujemy na zapas.

## Weryfikacja

- Lokalnie przed pushem: `npm run prepare-mydevil` w obu katalogach → `.mydevil/` ma oczekiwaną zawartość; `cd .mydevil && npm ci --omit=dev && PORT=4100 node app.mjs` (frontend) i `PORT=3100 node app.js` (api) odpowiadają na `curl localhost:<port>`.
- Actions: oba joby zielone, w logu `health-check OK`.
- `curl -sI https://subtracker.jakubpietrzykowski.pl` → `200`, HTML zawiera wyrenderowaną treść (nie pusty `<app-root>`).
- `curl -s https://apisubtracker.jakubpietrzykowski.pl/` → `Hello World!`; certyfikat ważny (`curl` bez `-k`).
- Serwer: `forever list` — `subtracker-api`, `subtracker-frontend` na `/usr/local/bin/node24`.
- Klucz CI: `ssh -i ~/.ssh/subtracker_deploy <user>@<host> ls` → odrzucone.
- Rollback: po drugim deployu `~/bin/rollback.sh api` → poprzednia wersja odpowiada; ponowny `workflow_dispatch` przywraca najnowszą.
- Restart serwera (symulacja): `forever stopall && ~/bin/start-all.sh` → obie aplikacje wstają.

## Stan wykonania (2026-10-02)

- [x] Zmiany w repo (pkt 1–9; entry `app.mjs`/`app.js` po uwadze użytkownika) — `prepare-mydevil` obu aplikacji zweryfikowane lokalnie: czysty `npm ci --omit=dev` w `.mydevil/`, frontend `200` (także `/main-*.js` i `/favicon.ico` z `public/`; Host `subtracker.jakubpietrzykowski.pl` → `200`, obcy Host → `400`), API `Hello World!`; backend lint + testy zielone; `ci-gate.sh` odrzuca wszystko poza `deploy <frontend|api> <sha>`.
- [ ] Bramki A–C (użytkownik)
- [ ] Push na `main` i weryfikacja produkcyjna (D + Weryfikacja)
