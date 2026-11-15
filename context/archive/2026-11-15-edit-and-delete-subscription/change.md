---
change_id: edit-and-delete-subscription
title: Edit and delete subscription
status: archived
created: 2026-11-15
updated: 2026-11-15
archived_at: 2026-11-15T10:43:01Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Wysokość przycisków (decyzja użytkownika, faza 3, 2026-11-15):** przycisk główny (`mat-flat-button`) nie ma już nadpisanej wysokości 48 px z ui-foundation (`context/archive/2026-11-10-ui-foundation/plan.md:83`). Wszystkie przyciski mają domyślne 40 px Materiala, więc para „akcja główna + drugorzędna” (dialog usunięcia, panel edycji) różni się tylko kolorem. Zmiana obejmuje całą aplikację (register, sign-in, verify-link, „Dodaj subskrypcję”, zapis formularza). Strona startowa ma własne 52 px. Wyjątek: „Dodaj” własnej kategorii zostaje na 48 px, bo stoi w jednym rzędzie z polem 48 px (`subscription-form.scss`). Kolejne slice'y nie przywracają 48 px bez nowej decyzji.
- **Ustalenia z ręcznych testów faz 2–3:** „Anuluj” w edycji, ikony ołówka i kosza w akcjach tabeli, tło `--st-page` rozwiniętego wiersza na telefonie, szerokości tabeli (pełna od 840 px, kompaktowa poniżej, minimum 500 px), równe przyciski w dialogu.
- **Przegląd implementacji:** `reviews/impl-review.md`; poprawki F1–F6 wprowadzone według zaleceń.
