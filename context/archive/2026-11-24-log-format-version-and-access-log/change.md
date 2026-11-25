---
change_id: log-format-version-and-access-log
title: Jednolity format logów, wdrożona wersja i access log
status: archived
created: 2026-11-24
updated: 2026-11-25
archived_at: 2026-11-25T11:03:15Z
---

## Notes

S-14 z roadmapy M-2 (FR-022): jednolity format logów obu procesów bez kodów kolorów, ze znacznikiem czasu ISO ze strefą; linia startowa i /health podają wdrożoną wersję; każde żądanie zostawia jedną linię access logu (metoda, trasa, status, czas). Ma pójść jako /goal + /10x-goal-implement w osobnym worktree. Z S-16: ujednolicić linie err.log, które nadal niosą komunikat błędu bazy (backend-patterns.md, „Logi błędów i odmów”, stan po S-16).
