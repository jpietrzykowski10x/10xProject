---
change_id: client-and-ssr-error-visibility
title: Widoczność błędów przeglądarki i SSR oraz przeładowanie po wdrożeniu
status: implementing
created: 2026-11-25
updated: 2026-11-25
archived_at: null
---

## Notes

S-15 z roadmapy M-2 (FR-023): strony i formularze nie zamieniają nieznanego błędu w ogólny komunikat bez zapisu przyczyny, błąd nawigacji przy renderowaniu na serwerze (SSR) nie wygląda jak 404, a nieaktualny plik aplikacji po wdrożeniu (chunk load) przeładowuje stronę. Otwarte: czy błędy z przeglądarki trafiają do API (PRD Open Questions #2) — domyślnie tylko konsola przeglądarki i log serwera SSR. Ryzyka: server.ts i server-log.ts po S-14 (access log, format logu), zmiana zachowania guardów i formularzy widoczna dla użytkownika — testy e2e komunikatów muszą zostać zielone. Równolegle research S-18 (lista subskrypcji, sortowanie/filtrowanie) — wskazać pliki wspólne.
