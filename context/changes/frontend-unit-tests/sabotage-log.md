# Kontrola celowego uszkodzenia

Każde uszkodzenie było zmianą tylko w working tree, cofniętą `git checkout -- <plik>` po przebiegu.

| Plik testów | Uszkodzenie w kodzie | Test, który odpadł | Data |
| --- | --- | --- | --- |
| `shared/decimal.spec.ts`, `subscriptions/subscription-validators.spec.ts` | `decimal.ts`: U+00A0 usunięte z `GROUP_SEPARATORS` | `reads "1 299,00" … as 1299` (`parseDecimal`, `parseAmount`), `accepts "1 299,00"` (`amountValidator`) — 3 z 62 | 2026-11-13 |
| `shared/decimal.spec.ts` | `decimal.ts`: kwantyfikator części ułamkowej `{1,N}` → `{1,}` | `rejects "1,234" with at most 2 decimals`, `rejects "1,2345" with at most 3 decimals` — 2 z 22 | 2026-11-13 |
| `subscriptions/subscription-validators.spec.ts` | `subscription-validators.ts`: usunięty warunek `amount <= AMOUNT_MAX` | `rejects "100 000"`, `flags "100 000"` — 2 z 40 | 2026-11-13 |
| `test-time-zone.spec.ts` | `scripts/test-time-zones.mjs`: `TZ: "UTC"` zamiast strefy z listy (nagłówek nadal „Europe/Warsaw”) | `has a winter UTC offset on the expected side of Greenwich (UTC)`; skrypt kończy się kodem 1 | 2026-11-13 |

Uwaga: pierwsza wersja strażnika pomijała strefę spoza listy, więc przebieg w UTC byłby zielony. Strażnik został zaostrzony przed tą kontrolą: strefa spoza listy oczekiwanych jest błędem.
