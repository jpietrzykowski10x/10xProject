---
change_id: failure-causes-and-audit-trail
title: Przyczyny porażek jobów i maili oraz ślad audytowy
status: implemented
created: 2026-11-24
updated: 2026-11-24
archived_at: null
---

## Notes

S-16 z roadmapy M-2 (FR-024): zadania cykliczne i wysyłka maili rozróżniają przyczyny porażki (brak konta, konto zablokowane, błąd bazy, błąd SMTP), a usunięcie konta, odmowy akcji administratora i jego wyszukiwania zostawiają ślad audytowy. Źródło: audyt context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md (§6 pkt 8 i powiązane ustalenia). Do tego zaległe testy z przeglądów S-11: recordSkipped przy podniesionej fladze running w trzech schedulerach oraz granica 12 h w watchdog-policy.spec.ts z dosłownymi czasami.
