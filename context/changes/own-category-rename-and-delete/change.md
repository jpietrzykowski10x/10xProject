---
change_id: own-category-rename-and-delete
title: Zmiana nazwy i usuwanie własnych kategorii
status: implemented
created: 2026-11-24
updated: 2026-11-25
archived_at: null
---

## Notes

S-17 z roadmapy M-2 (FR-025, FR-009, FR-010): użytkownik zmienia nazwę własnej kategorii albo usuwa ją, jeśli nie ma w niej subskrypcji; przy niepustej widzi komunikat, że najpierw musi przenieść albo usunąć jej subskrypcje. Kategorie predefiniowane się nie zmieniają, a próg duplikatów i limit budżetu usuwanej kategorii nie zostają osierocone. Otwarte: gdzie w UI (budżet, formularz subskrypcji, osobna lista kategorii) — makiety ASCII do wyboru wg lessons.md. Ryzyka: FK subscription.category_id (23503 → 409, helper w shared/database/), unikalność nazw (toNameKey) przy zmianie nazwy, sortowanie POLISH_COLLATION. S-14 biegnie równolegle w osobnym worktree (logi, server.ts, /health) — unikać tych plików.

Rozszerzenie zakresu w fazie 2 (2026-11-25, decyzja użytkownika po teście ręcznym): na `/budget` pod listą kategorii wiersz „Nowa kategoria” — pole nazwy i przycisk „Dodaj” (`POST /categories`), przycisk nieaktywny do wpisania nowej, unikalnej nazwy (sprawdzenie w przeglądarce bez względu na wielkość liter, 409 z serwera jako błąd pola), po dodaniu pole czyste i przycisk znów nieaktywny; wyłączone przy niezapisanych zmianach progów jak ✎/🗑. Poprawka wąskiego desktopu: po przeniesieniu nazwy nad pola obie kolumny pól elastyczne (`minmax(0, 1fr)`), więc pola i wiersz nazwy wypełniają szerokość.
