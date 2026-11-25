---
change_id: own-category-rename-and-delete
title: Zmiana nazwy i usuwanie własnych kategorii
status: impl_reviewed
created: 2026-11-24
updated: 2026-11-25
archived_at: null
---

## Notes

S-17 z roadmapy M-2 (FR-025, FR-009, FR-010): użytkownik zmienia nazwę własnej kategorii albo usuwa ją, jeśli nie ma w niej subskrypcji; przy niepustej widzi komunikat, że najpierw musi przenieść albo usunąć jej subskrypcje. Kategorie predefiniowane się nie zmieniają, a próg duplikatów i limit budżetu usuwanej kategorii nie zostają osierocone. Otwarte: gdzie w UI (budżet, formularz subskrypcji, osobna lista kategorii) — makiety ASCII do wyboru wg lessons.md. Ryzyka: FK subscription.category_id (23503 → 409, helper w shared/database/), unikalność nazw (toNameKey) przy zmianie nazwy, sortowanie POLISH_COLLATION. S-14 biegnie równolegle w osobnym worktree (logi, server.ts, /health) — unikać tych plików.

Rozszerzenie zakresu w fazie 2 (2026-11-25, decyzja użytkownika po teście ręcznym): na `/budget` osobny panel „Nowa kategoria” pod formularzem (poza `<form>`) — pole nazwy i przycisk „Dodaj” (`POST /categories`), przycisk nieaktywny do wpisania nowej, unikalnej nazwy (sprawdzenie w przeglądarce bez względu na wielkość liter, 409 z serwera jako błąd pola), po dodaniu pole czyste i przycisk znów nieaktywny; wyłączone przy niezapisanych zmianach progów jak ✎/🗑, a w trakcie dodawania formularz budżetu jest wyłączony (impl-review F1). Układ strony to trzy wizualnie oddzielone panele: progi domyślne i limit całościowy, kategorie z „Zapisz” bezpośrednio pod listą, „Nowa kategoria”; osobny zapis progów domyślnych odłożony (`follow-ups/separate-budget-saves.md`). Poprawka wąskiego desktopu: po przeniesieniu nazwy nad pola obie kolumny pól elastyczne (`minmax(0, 1fr)`), więc pola i wiersz nazwy wypełniają szerokość.

Na prośbę użytkownika (2026-11-25) w `backend-subtracker/test/access-log.e2e-spec.ts` (S-14) czekanie na linię `Access` wydłużone do 5 s: test raz nie zmieścił się w domyślnej 1 s przy pełnym przebiegu e2e (commit 0b198e6).
