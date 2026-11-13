# Kontrola celowego uszkodzenia

Każde uszkodzenie było zmianą tylko w working tree, cofniętą `git checkout -- <plik>` po przebiegu.

| Plik testów | Uszkodzenie w kodzie | Test, który odpadł | Data |
| --- | --- | --- | --- |
| `shared/decimal.spec.ts`, `subscriptions/subscription-validators.spec.ts` | `decimal.ts`: U+00A0 usunięte z `GROUP_SEPARATORS` | `reads "1 299,00" … as 1299` (`parseDecimal`, `parseAmount`), `accepts "1 299,00"` (`amountValidator`) — 3 z 62 | 2026-11-13 |
| `shared/decimal.spec.ts` | `decimal.ts`: kwantyfikator części ułamkowej `{1,N}` → `{1,}` | `rejects "1,234" with at most 2 decimals`, `rejects "1,2345" with at most 3 decimals` — 2 z 22 | 2026-11-13 |
| `subscriptions/subscription-validators.spec.ts` | `subscription-validators.ts`: usunięty warunek `amount <= AMOUNT_MAX` | `rejects "100 000"`, `flags "100 000"` — 2 z 40 | 2026-11-13 |
| `test-time-zone.spec.ts` | `scripts/test-time-zones.mjs`: `TZ: "UTC"` zamiast strefy z listy (nagłówek nadal „Europe/Warsaw”) | `has a winter UTC offset on the expected side of Greenwich (UTC)`; skrypt kończy się kodem 1 | 2026-11-13 |
| `shared/date-only.spec.ts` (TZ `Europe/Warsaw`) | `date-only.ts`: `toDateOnly` zwraca `toISOString().slice(0, 10)` | `writes … as "2026-01-05"` i kolejne zapisy lokalnej północy — dzień wcześniej na wschód od UTC | 2026-11-13 |
| `shared/date-only.spec.ts` (TZ `America/New_York`) | `date-only.ts`: `parseDateOnly` zwraca `new Date(value)` | `reads "2026-11-15" as local midnight of [2026,11,15,0,0]` i 2 kolejne — dzień wcześniej na zachód od UTC (3 testy) | 2026-11-13 |
| `shared/date-only.spec.ts` | `date-only.ts`: `parseDayMonthYear` bez porównania składników daty | `rejects "29.02.2027"`, `"31.02.2027"`, `"31.04.2026"`, `"0.01.2026"` | 2026-11-13 |
| `shared/pl-date-adapter.spec.ts` | `pl-date-adapter.ts`: `null` zamiast `this.invalid()` | `turns "abc" / "31.02.2027" / "2026-01-05" into an invalid date, not null` (3 testy) | 2026-11-13 |
| `shared/validation/not-before-date.spec.ts` | `not-before-date.ts`: porównanie `getTime()` zamiast dni | `accepts the same day, earlier hour` — 1 z 10 | 2026-11-13 |
| `shared/validation/trimmed-required.spec.ts` | `trimmed-required.ts`: bez `trim()` | `flags " " / "   " / "\t" as required` | 2026-11-13 |
| `subscriptions/subscription-request.spec.ts` | `subscription-request.ts`: `trialEndDate` wysyłane dla każdego statusu | `sends an active subscription with a leftover trial end`, `sends a pending cancellation with a leftover trial end` (2 testy) | 2026-11-13 |
| `subscriptions/subscription-amounts.spec.ts` | `subscription-amounts.ts`: `Math.floor` zamiast `Math.round` | `divides a yearly "12.06" into "1.01" a month`, `"12.07"`, `"0.06"` — połówka i reszta grosza | 2026-11-13 |

Uwaga: pierwsza wersja strażnika pomijała strefę spoza listy, więc przebieg w UTC byłby zielony. Strażnik został zaostrzony przed tą kontrolą: strefa spoza listy oczekiwanych jest błędem.
