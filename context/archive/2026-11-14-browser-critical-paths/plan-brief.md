# Krytyczne ścieżki w przeglądarce (etap 4) — Plan Brief

> Full plan: `context/changes/browser-critical-paths/plan.md`
> Research: `context/changes/browser-critical-paths/research.md`

## What & Why

Etap 4 planu testów ma dać bramkę CI dla dwóch ryzyk, których nie widzą ani unity, ani e2e
backendu. Ryzyko #2: na zbudowanym serwerze SSR strona startowa źle przekierowuje albo trafia do
cache, trasa z guardem zostaje prerenderowana w buildzie, a guard w przeglądarce podejmuje złą
decyzję. Ryzyko #1: dodana subskrypcja nie wraca na listę właściciela albo dane jednego konta
zostają widoczne po zalogowaniu drugiego w tej samej karcie.

## Starting Point

Na froncie są tylko testy unit i komponentów (Vitest przez `ng test`). Macierz guardów jest
pokryta unitami, a izolacja kont w API e2e backendu (job `backend-e2e`). Build produkcyjny woła
produkcyjne API. Skrypty `dev-local/` (sesja bez maila) celowo nie działają w CI.

## Desired End State

`npm run build:e2e && npm run e2e` w `frontend-subtracker/` uruchamia Playwrighta na zbudowanym
SSR (:4000) i prawdziwym API (:3000) z bazą. Projekt `http` dowodzi kontraktu render mode i cache,
projekt `chromium` 3 przejść guardów i przepływu dodania ze zmianą konta. Ten sam zestaw biegnie
w nowym jobie CI `browser-e2e`, a §6.5 planu testów opisuje, jak dodać następny test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Narzędzie | `@playwright/test` ~1.65.1 (checked: 2026-11-14) | Kandydat z §4; jeden runner dla HTTP i przeglądarki. | Plan |
| Testy HTTP | Projekt `http` z fixture `request`, bez przeglądarki | Status, `Location` i `Cache-Control` nie potrzebują przeglądarki. | Plan (Q1) |
| Lokalizacja | `frontend-subtracker/e2e/`, `pg` jako devDependency frontu | Zostają dwie niezależne aplikacje, blokada `dev-local` nienaruszona. | Plan (Q2) |
| Serwery | Playwright `webServer` startuje gotowe buildy; build osobnym skryptem | Jedno polecenie lokalnie i w CI bez przebudowy przy każdym biegu. | Plan (Q3) |
| Strażnik prerenderu | `prerendered-routes.json` = dokładnie strony statyczne z §7 | Łapie także trasę z guardem, której test HTTP nie wymienia. | Plan (Q4) |
| Build e2e | `--configuration production,e2e`, lokalne API, osobny `outputPath` | Optymalizacja jak w produkcji bez ryzyka spakowania lokalnego API na MyDevil. | Research + Plan |
| Konta i sesje | Insert `user` + `user_role` + `session` do bazy, sprzątanie po prefiksie | Rejestracja przez API wysyła maila (lokalnie prawdziwy SMTP). | Research + Plan |
| Zmiana konta | Ta sama karta, druga sesja, kotwica w postaci własnej pozycji konta B | Osobne konteksty sprawdzałyby tylko API; „nie widać” bez kotwicy przechodzi na pustym ekranie. | Research |
| Zakres macierzy | Bez serwerowego „API nie odpowiada” i bez wygasłej sesji w przeglądarce | Pokryte unitami; e2e tylko to, czego unit nie widzi. | Research |
| CI | Nowy job `browser-e2e`: Postgres `C.UTF-8` + migracje, origin :4000 | `frontend` nie ma bazy, `backend-e2e` nie ma frontu. | Research |

## Scope

**In scope:** Playwright i build `e2e`; pomocnik kont i sesji; testy HTTP strony startowej, powłoki
CSR i prerenderu; 3 przejścia guardów; przepływ dodania ze zmianą konta; job `browser-e2e`;
§4/§5/§6.5/§6.6/§8 planu testów, CLAUDE.md, `.env.example`.

**Out of scope:** powtórzenie macierzy guardów; pola, walidacja i treść komunikatów formularza;
izolacja API w osobnych kontekstach; inne przeglądarki, układ telefonu, testy wizualne; atrybuty
`domain`/`secure` ciasteczka; branch protection (robi właściciel); warstwa AI-native.

## Architecture / Approach

`playwright.config.ts` ładuje `.env` backendu, sprawdza `MODE=DEV`, lokalny host bazy i origin
:4000 w `CORS_ORIGINS`, po czym startuje (albo używa działających) serwery SSR z
`dist/frontend-subtracker-e2e` i API. Testy dostają ciasteczko `subtracker_session` z sesji
wstawionej do bazy; ciasteczko dla `localhost` trafia do obu portów. Jedyną podmianą jest sieć
(`page.route`) w teście „API niedostępne”.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Szkielet e2e | Playwright, build `e2e`, `webServer`, pomocnik kont, test dymny | Build e2e nadpisuje produkcyjny `dist` lub lokalny CORS blokuje :4000 |
| 2. Testy HTTP SSR (#2) | Strona startowa × 3 stany sesji, powłoka CSR, strażnik prerenderu | Wyrocznia przepisana z pliku tras zamiast z kontraktu |
| 3. Przejścia guardów (#2) | Brak sesji → `/sign-in`, API niedostępne → „niedostępne” z adresem, zalogowany na `/sign-in` → lista | Dublowanie unitów |
| 4. Przepływ i zmiana konta (#1) | Dodanie → lista po przeładowaniu → konto B bez pozycji A | Fałszywie zielone „nie widać” bez kotwicy |
| 5. Job CI `browser-e2e` | Bramka na PR z raportem przy błędzie | Czas joba, instalacja Chromium |
| 6. Plan testów i dokumentacja | §4/§5/§6.5/§6.6/§8, CLAUDE.md, `.env.example` | Cookbook zbyt ogólny, by z niego korzystać |

**Prerequisites:** lokalny Postgres z `subtracker-db-dev`; `CORS_ORIGINS` w
`backend-subtracker/.env` rozszerzone o `http://localhost:4000`; Node 24.
**Estimated effort:** ~3–4 sesje (fazy 1 i 5 najdroższe w uruchamianiu, 2–4 to po kilka testów).

## Open Risks & Assumptions

- Lokalnie testy biegną na ostatnim `build:e2e`; zapomniana przebudowa daje wynik dla starego kodu
  (świadomy koszt decyzji Q3, opisany w §6.5).
- Zakładamy, że wartości wymagane przez wstawiany wiersz `user` (wersja polityki prywatności,
  zgody) da się odczytać ze stałych backendu; inaczej pomocnik musi je zduplikować z komentarzem.
- Asercja ciała odpowiedzi `/auth/session` w stanie transferu opiera się na braku tego ciągu w
  HTML; jeśli Angular zmieni format kluczy transfer cache, test może przestać wykrywać regresję.

## Success Criteria (Summary)

- Sabotaże render mode, nagłówków, guardów i cache listy dają czerwone testy (lokalnie i w CI).
- Job `browser-e2e` zielony na PR i oznaczony jako wymagany.
- Nowy test e2e da się dodać według §6.5 bez czytania istniejących testów.
