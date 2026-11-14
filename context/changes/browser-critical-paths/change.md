---
change_id: browser-critical-paths
title: Krytyczne ścieżki w przeglądarce — e2e na zbudowanym SSR (etap 4 planu testów)
status: implemented
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Critical browser paths".
Risks covered: #2 (guard SSR/przeglądarka: przekierowania i brak cache strony zalogowanego), #1 (IDOR — cudze subskrypcje i kategorie). Test types planned: e2e.
Risk response intent:
- #2: dla {serwer, przeglądarka} × {brak ciasteczka, ważna sesja, wygasła sesja, API nie odpowiada} guard daje oczekiwane przekierowanie, a strona zalogowanego nie jest cache'owana; nie zakładać, że „działa w ng serve, więc działa w SSR”; e2e na zbudowanym serwerze SSR tylko dla render mode, cache i 2–3 przejść (resztę pokrywają unit guardów); nie mockować wnętrza guarda zamiast granicy HTTP.
- #1: w przeglądarce dodana subskrypcja jest widoczna na liście właściciela i nie pojawia się u drugiego konta; izolację po stronie API pilnują już e2e backendu (etap 3), więc tu tylko przejście end-to-end, bez dublowania testów API.
After creating the folder, follow the downstream continuation rule.
