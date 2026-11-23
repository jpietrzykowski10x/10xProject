# Alarm o padnięciu API i zadań cyklicznych — Plan Brief

> Full plan: `context/changes/operator-liveness-alerts/plan.md`
> Research (audyt): `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md`

## What & Why

Dziś API w pętli restartów albo zadanie cykliczne, które od tygodni nie działa, wyglądają w logach jak cisza. Pierwszym sygnałem byłoby zgłoszenie użytkownika (audyt: P1, J1, J2 krytyczne, J4 wysokie). S-11 (PRD v2 FR-019, gwiazda przewodnia M-2) sprawia, że operator dostaje mail, gdy API albo frontend nie odpowiada, gdy zadanie padło i gdy nie ruszyło od 26 h.

## Starting Point

Trzy schedulery (cykl życia, sprzątanie auth, przypomnienia o trialu) logują tylko wtedy, gdy coś zmieniły. Nie zapisują przebiegów, a mail do operatora wysyła tylko przypomnienie o trialu przy błędzie całego przebiegu. `/health` robi `SELECT 1`, a sprawdza go tylko `deploy.sh`. `main.ts` nie ma handlerów nieobsłużonych wyjątków.

## Desired End State

Każdy przebieg zadania zostawia wiersz `job_run` i linię podsumowania. Przy błędzie albo częściowej porażce API mailuje operatorowi. `/health` (nadal 200 przy działającej bazie) pokazuje `jobs: ok|stale|failed`. Watchdog z crona co 5 minut sprawdza API i frontend. Mailuje po 3 kolejnych porażkach, przypomina co 12 h i raz zgłasza powrót. Tak samo traktuje zadanie, które nie ruszyło od 26 h.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Wysyłka maila z watchdoga | Skrypt Node `cli/watchdog.js` z paczki API, transport operatora bez `MailService` | Ten sam SMTP i walidacja env co API, testy w Vitest; `MailService` potrzebuje bazy, która może leżeć | Plan |
| Polityka alarmu | Co 5 min API i frontend; mail po 3 kolejnych porażkach, przypomnienie co 12 h, jeden mail o powrocie | Restart MyDevil i deploy nie alarmują, długa awaria nie zalewa skrzynki | Plan (zmiana użytkownika: 3 porażki, 12 h) |
| Rejestr przebiegów | Tabela `job_run`, wiersz na przebieg, retencja 90 dni | Historia dla S-16 i diagnozy; „nie ruszył od 26 h” to jedno zapytanie | Plan |
| `/health` przy złych jobach | 200 + pole `jobs`; deploy nadal patrzy tylko na bazę | Porażka joba nie może cofać deployu ani przywracać dumpu (znaczniki przypomnień) | Plan |
| Kto mailuje o `failed`, a kto o `stale` | `failed`/`partial`: API przy przebiegu; `stale`: watchdog | Bez podwójnych maili; zadania, które nie ruszyło, API samo nie zauważy | Plan |
| Miejsce kodu | Moduł `src/jobs/`, czyste funkcje w `jobs/`, `watchdog/`, `shared/process/` | `shared/` nie może zależeć od `MailService` (`lessons.md`) | Research (lessons) |
| `usersFailed > 0` w przypomnieniach | Wynik `partial` z mailem | Systemowa awaria rezerwacji nie może wyglądać na udany przebieg (J4) | Research (audyt) |

## Scope

**In scope:**
- tabela `job_run` i `JobRunService.track`,
- trzy schedulery na rejestrze, mail przy `failed`/`partial`, podsumowanie każdego przebiegu w logu,
- `/health.jobs` (26 h),
- handlery `uncaughtException`/`unhandledRejection`,
- watchdog (logika, CLI, `watchdog.sh`),
- dokumentacja, crontab i testy na produkcji.

**Out of scope:**
- osobny kanał alarmów (S-12),
- przyczyny porażek w rozbiciu (S-16),
- format logu, SHA, access log (S-14),
- monitor spoza serwera (proxy, DNS),
- automatyczny rollback przy nieudanym przebiegu startowym,
- kolacja i migracje w `/health`,
- widok przebiegów w UI.

## Architecture / Approach

Wewnątrz API: scheduler → `JobRunService.track(job, trigger, run)`. `track` zapisuje start, woła serwis, zapisuje wynik i liczniki, loguje, a przy porażce woła `notifyOperator`. `/health` → `jobHealth(latestFinished, now)`. Poza API: crontab → `watchdog.sh` (blokady deployu, porty) → `node24 cli/watchdog.js`. CLI robi `fetch localhost`, czyta plik stanu `~/apps/subtracker/watchdog/state.json`, liczy `decide(...)` i wysyła mail transportem operatora.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rejestr przebiegów i alarm z API | `job_run`, `track`, mail przy porażce, schedulery na rejestrze | Zmiana startu w tle przypomnień opóźni health-check deployu |
| 2. `/health` z `jobs` i handlery procesu | Stan zadań w `/health`, bezpieczny log padnięcia | Przypadkowa zmiana kodu odpowiedzi łamie deploy |
| 3. Watchdog | Logika 3/12 h, CLI, `watchdog.sh` | Osierocona blokada deployu ucisza watchdoga (zabezpieczenie: 30 min) |
| 4. Dokumentacja i produkcja | Wzorce, README, crontab, test na serwerze | Ręczne kroki (`scp`, crontab) pominięte przy wdrożeniu |

**Prerequisites:** zmergowany `chore/10x-m3-observability` (PRD v2, roadmapa M-2); przed pierwszym PR-em M-2 `chore/` z `/10x-impl-review-ci`; ustawione `NOTIFICATION_ADMINISTRATOR_MAIL` na produkcji (jest).
**Estimated effort:** ~2–3 sesje w 4 fazach.

## Open Risks & Assumptions

- Do czasu S-12 alarm idzie tym samym SMTP co maile użytkowników (bez `NOTIFICATION_SMTP_*`). Awaria całej poczty MyDevil wyłącza też alarmy.
- Watchdog widzi tylko `localhost`, więc awaria proxy MyDevil zostaje niewidoczna.
- Zepsuta paczka API (brak `node_modules`) wyłącza też watchdoga, bo działa z tego samego wydania.
- Rotacja logów na MyDevil niepotwierdzona; watchdog loguje tylko przy akcji, a cotygodniowe obcinanie `*.log` > 20 MB jest w crontabie.

## Success Criteria (Summary)

- Zatrzymane API na produkcji daje mail w ~15 minut, a po starcie jeden mail o powrocie.
- Padnięcie albo częściowa porażka dowolnego zadania daje mail, a `/health` pokazuje `stale`, gdy zadanie nie ruszyło od 26 h.
- Deploy przechodzi bez fałszywych alarmów i bez zmiany zachowania health-checku.
