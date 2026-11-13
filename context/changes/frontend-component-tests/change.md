---
change_id: frontend-component-tests
title: Frontend component tests
status: implementing
created: 2026-11-13
updated: 2026-11-13
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Faza 1, test a) (research Open Question 1)**: błąd pola „Nazwa nowej kategorii” pojawia się po próbie zapisu bez zmian w produkcji. Kontrolka `categoryName` jest poza grupą `form`, ale domyślny `ErrorStateMatcher` widzi `submitted` rodzica `FormGroupDirective`. Poprawka w `submit()` nie była potrzebna.
- **Faza 1, sabotaże**: `@if (isTrial())` → `@if (true)`, usunięte `trialEndDate.enable()` i usunięty warunek `trial &&` w `toCreateSubscriptionRequest` — każdy dał dokładnie jeden czerwony test.
- **Formatowanie**: `npx prettier --check src` zgłasza pliki z CRLF w working tree (`core.autocrlf=true`, indeks ma LF) — problem środowiska sprzed tej zmiany; pliki fazy przechodzą.
