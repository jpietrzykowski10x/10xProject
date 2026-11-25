---
change_id: own-category-rename-and-delete
title: Zmiana nazwy i usuwanie własnych kategorii
status: implementing
created: 2026-11-24
updated: 2026-11-25
archived_at: null
---

## Notes

S-17 z roadmapy M-2 (FR-025, FR-009, FR-010): użytkownik zmienia nazwę własnej kategorii albo usuwa ją, jeśli nie ma w niej subskrypcji; przy niepustej widzi komunikat, że najpierw musi przenieść albo usunąć jej subskrypcje. Kategorie predefiniowane się nie zmieniają, a próg duplikatów i limit budżetu usuwanej kategorii nie zostają osierocone. Otwarte: gdzie w UI (budżet, formularz subskrypcji, osobna lista kategorii) — makiety ASCII do wyboru wg lessons.md. Ryzyka: FK subscription.category_id (23503 → 409, helper w shared/database/), unikalność nazw (toNameKey) przy zmianie nazwy, sortowanie POLISH_COLLATION. S-14 biegnie równolegle w osobnym worktree (logi, server.ts, /health) — unikać tych plików.
