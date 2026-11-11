---
change_id: csrf-protection
title: Ochrona CSRF w API przed S-02
status: implemented
created: 2026-11-11
updated: 2026-11-11
archived_at: null
---

## Notes

Bloker S-02 z roadmapy, follow-up F1 z pełnego przeglądu S-01 (`context/archive/2026-11-03-magic-link-sign-in/reviews/impl-review.md`): obca strona może automatycznym POST-em na `/auth/verify` z tokenem atakującego zalogować ofiarę na jego konto (login CSRF); ten sam brak dotyczy `/auth/logout` i przyszłych tras S-02.

Kierunek z przeglądu: `app.enableCsrfProtection({ trustedOrigins: env.CORS_ORIGINS })` w `applyHttpSecurity` (wspólne dla `main.ts` i e2e) plus testy e2e na odrzucenie obcego `Origin` i `Sec-Fetch-Site`. Po potwierdzeniu na produkcji dopisać wzorzec do `context/foundation/backend-patterns.md` i do `fyi/mydevil-boilerplate-skill-spec.md` (10.6).
