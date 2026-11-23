---
change_id: request-context-and-denial-reasons
title: Request context and denial reasons
status: archived
created: 2026-11-23
updated: 2026-11-23
archived_at: 2026-11-23T19:48:06Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Odstępstwa od kontraktu planu przyjęte w przeglądzie (F1 z `reviews/impl-review.md`):

- Konto przy odmowach linku (`link_user_missing`, `link_account_blocked`, `link_race`) ma klucz `account`, nie `user`, bo `user=` w linii to wywołujący (przed zalogowaniem `-`).
- `link_race` oznacza też token, który przy drugim odczycie jest niezużyty i ważny: zmienił się między zapytaniami.
- Wartości `ids` dopuszczają `_` (`action=reset_sessions`).
- `role_missing` bez `actor`, gdy na żądaniu nie ma użytkownika; origin `null` jako `origin=invalid`.
- Krok ręczny 3.5: w jednej przeglądarce wylogowanie w innej karcie daje `session_missing` (wspólne ciasteczko); `session_revoked` sprawdza e2e.
