---
change_id: independent-alert-channel
title: Niezależny kanał alarmów operatora
status: implementing
created: 2026-11-23
updated: 2026-11-23
archived_at: null
---

## Notes

S-12 z roadmapy: alarm do operatora dochodzi także wtedy, gdy nie działa wysyłka maili do użytkowników; na produkcji wymagany osobny kanał alarmowy (NOTIFICATION_SMTP_*, osobna skrzynka na MyDevil, już założona przez użytkownika i wpisana do lokalnych .env i .env.mydevil), blokada powtórzeń zaczyna działać dopiero po przyjęciu alarmu, a odrzucenie adresata przez serwer pocztowy (relay, limit wysyłki) jest odróżnione od literówki w adresie. FR-020, audyt L2, L3, J6, J10.
