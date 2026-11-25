# Widoczność błędów przeglądarki i SSR — Plan Brief

> Full plan: `context/changes/client-and-ssr-error-visibility/plan.md`
> Research: `context/changes/client-and-ssr-error-visibility/research.md`

## What & Why

S-15 (FR-023). Dziś nieznany błąd w przeglądarce kończy się ogólnym komunikatem i nie zostawia żadnego śladu. Błąd nawigacji na serwerze SSR wygląda jak 404 „Cannot GET”. Po wdrożeniu kliknięcie w stronę, której plik zniknął, po cichu nic nie robi. Chcemy widzieć przyczyny i nie gubić użytkownika po deployu.

## Starting Point

25 gałęzi `error:` bez zapisu przyczyny, router bez obsługi błędów nawigacji, a `server.ts` oddaje `null` i wyjątki Expressowi (404 albo surowy stos). `server-log.ts` z S-14 ma już poziom `ERROR`, którego nic nie używa.

## Desired End State

- Nieznany błąd zostawia jedną linię: w konsoli przeglądarki albo `ERROR` w logu SSR, w formacie S-14.
- Błąd nawigacji na serwerze daje 500 ze stroną „niedostępne”.
- Wyjątek renderu daje jedną linię `ERROR [Render]` zamiast surowego stosu.
- Nieaktualny plik po wdrożeniu przeładowuje stronę raz, a przy powtórce w ciągu 60 s pokazuje „niedostępne”, bez pętli.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Błędy do API (OQ #2) | Nie, tylko konsola i log SSR | PRD nie rozstrzygnął limitu ani zakresu danych | Research / Plan |
| Które gałęzie logują | Tylko „nieznany błąd” | Rozpoznane 400/404/409 to odpowiedzi biznesowe, nie problemy | Plan |
| S5/S6 (komunikaty) | Tylko zapis przyczyny; UI → follow-up | Cel FR-023 to widoczność dla nas; e2e komunikatów bez zmian | Plan |
| Błąd nawigacji SSR | `/unavailable` + 500 + `ERROR` (handler routera) | Użytkownik widzi naszą stronę, log zna metodę i ścieżkę | Plan |
| Middleware błędów `server.ts` | Linia `ERROR [Render]`, 500 tekstem, `AbortError` bez linii | Zamyka S-14 F8; przerwanie widać już w access logu | Research / Plan |
| Reporter na dwóch platformach | `ErrorReporter` + `ServerErrorReporter` podmieniany w `app.config.server.ts` | Kod logu serwera nie trafia do bundla przeglądarki | Plan |
| Ochrona przed pętlą | `sessionStorage`, 1 przeładowanie / adres / 60 s, bez magazynu brak przeładowania | Brak przeładowania jest lepszy niż pętla | Plan |
| Dowód SSR | Trasa z rzucającym guardem tylko w buildzie e2e + własny proces `server.mjs` w teście | Dowód na prawdziwym serwerze, także w CI | Plan |

## Scope

**In scope:** reporter i jego wpięcie w L4, L5, L6, S5, S6, S7, A9 i wylogowanie; handler błędów nawigacji (serwer i przeglądarka); middleware błędów w `server.ts`; trasa testowa e2e; testy Vitest i Playwright; CLAUDE.md, test-plan, follow-up S5/S6.

**Out of scope:** wysyłka do API; zmiany komunikatów w UI; własny globalny `ErrorHandler`; częściowa strona 200 przy błędzie szablonu; backend, `deploy.sh`, `Cache-Control`.

## Architecture / Approach

Wywołanie `report(context, error)` w gałęzi błędu idzie do `ErrorReporter`. W przeglądarce kończy się `console.error`, na serwerze linią `serverLine('ERROR', …)` z metodą i ścieżką z `REQUEST`.

Jeden `withNavigationErrorHandler` rozgałęzia się po platformie:
- **Serwer:** raport, `RESPONSE_INIT.status = 500` i `RedirectCommand` na `/unavailable`.
- **Przeglądarka:** gdy błąd dotyczy ładowania modułu, `shouldReload` i `location.assign(url)`, a w przeciwnym razie raport i `/unavailable`.

Czyste funkcje (`describeError`, `renderErrorLines`, `shouldReload`, `isChunkLoadError`) mają testy w Vitest.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reporter i nieoczekiwane gałęzie | Ślad każdego nieznanego błędu w konsoli i w logu SSR | Dużo plików naraz; pominięta gałąź |
| 2. Błąd nawigacji SSR i middleware | 500 + „niedostępne” + `ERROR`; koniec surowego stosu | `RESPONSE_INIT` w handlerze routera nie ustawi statusu (fallback w planie) |
| 3. Przeładowanie po wdrożeniu i dokumentacja | Jedno przeładowanie zamiast martwego linku; zasady w CLAUDE.md | Wykrycie błędu modułu opiera się na tekstach komunikatów przeglądarek |

**Prerequisites:** gałąź `change/client-and-ssr-error-visibility` z `origin/main` (2ef328e); lokalne API dla e2e.
**Estimated effort:** ~2–3 sesje, 3 fazy.

## Open Risks & Assumptions

- Status 500 ustawiany przez `RESPONSE_INIT` w handlerze nawigacji potwierdza dopiero test `http` z fazy 2.
- Komunikaty błędów modułu w przeglądarkach pochodzą z wiedzy ogólnej. Nowy wariant komunikatu oznacza brak przeładowania, ale nie pętlę.
- Przeładowanie zadziała dopiero od deployu po S-15: karty otwarte przed nim mają stary kod.
- Kolizja z S-18 w `pages/subscriptions/subscriptions.ts`: S-18 startuje z `origin/main` po merge'u S-15.

## Success Criteria (Summary)

- Każdy nieznany błąd ma ślad z kontekstem, bez query i bez danych osobowych; rozpoznane statusy go nie mają.
- Na serwerze błąd nawigacji daje 500 ze stroną „niedostępne” i linię `ERROR`, a nie 404.
- Po wdrożeniu stara karta przeładowuje się raz i działa dalej.
