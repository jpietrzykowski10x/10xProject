<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Niezależny kanał alarmów operatora

- **Plan**: `context/changes/independent-alert-channel/plan.md`
- **Mode**: Deep
- **Date**: 2026-11-23
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, 4/4 symbols ✓ (`validateEnv`, `createMailTransport`, `notifyOperator`, `isRecipientRejected`), brief↔plan ✓.

Sprawdzone założenia:
- watchdog woła `validateEnv` i `createMailTransport` (`src/cli/watchdog.ts:92-117`), więc wymuszenie go obejmuje;
- nodemailer ustawia `response` z pełną linią odpowiedzi (`_formatError` w `smtp-connection`);
- `JobRunService` ignoruje wynik `notifyOperator`, a mock w `job-run.service.spec.ts:40` jest rzutowany, więc zmiana na `Promise<boolean>` niczego nie łamie.

## Findings

### F1 — Wymuszenie PROD łamie fikstury i skrypty spoza planu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — #1 Walidacja env; Migration Notes
- **Detail**: `validateEnv` z `MODE: 'PROD'` wołają też:
  - `src/database/database.options.spec.ts:15`: fikstura bez `NOTIFICATION_SMTP_*`, poza planem;
  - wspólna fikstura `prodEnv` w `src/config/env.spec.ts:14`;
  - `src/database/data-source.ts:14`: `migration:run` w `deploy.sh`;
  - `src/cli/role-script.ts:36`: skrypty ról.

  Bez kluczy deploy padnie już na migracji, a skrypty ról przestaną działać. Plan opisywał tylko brak startu API.
- **Fix**: Fikstury PROD w obu specach z kompletem `NOTIFICATION_SMTP_*`; Migration Notes i README opisują `migration:run`, skrypty ról i watchdoga.
- **Decision**: FIXED (faza 1 #1, faza 3 #1, Migration Notes, brief: Open Risks)

### F2 — Skrypt testowy w DEV nie mówi, którym kanałem wysłał

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — #3 Skrypt testowy
- **Detail**: W DEV bez `NOTIFICATION_SMTP_*` `createMailTransport` wraca do transportu użytkowników albo konsoli. `exit 0` nie dowodziłby wtedy osobnego kanału.
- **Fix**: Linia `operator channel: separate (<from>)` / `shared with SMTP_* (DEV)` / `console (DEV)` przed wysyłką, z testem.
- **Decision**: FIXED (faza 1 #3, brief: Open Risks)

### F3 — Ręczny test fazy 2 wymaga istniejącego konta

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Manual Verification
- **Detail**: `sendToUser` wysyła tylko na adres aktywnego konta (`mayReceive`), więc prośba o link dla obcego adresu nie próbuje wysyłki i alarm się nie pojawi.
- **Fix**: Krok ręczny dla adresu istniejącego, aktywnego konta (np. `DEV_USER_EMAIL`).
- **Decision**: FIXED (faza 2, Manual Verification)
