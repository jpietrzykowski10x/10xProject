# Follow-ups z przeglądu implementacji

Źródło: `context/changes/failure-causes-and-audit-trail/reviews/impl-review.md`.

## F6 — Start API nie powinien czekać na wysyłkę alarmu joba

- **Co:** `JobRunService.track` czeka (`await`) na `notifyOperator`, a przebiegi startowe cyklu życia i sprzątania są awaitowane przed `Nest application successfully started`. W teście 2.6 (S-16) start trwał 21 s przez nieudany alarm (`ESOCKET`); przy wiszącym SMTP do ~90 s, dłużej niż health-check `deploy.sh` (5 prób co 3 s), a nieudany health-check przywraca bazę z dumpu.
- **Od kiedy:** S-11 (`operator-liveness-alerts`), nie wprowadzone przez S-16; S-16 zwiększa liczbę przebiegów `partial` (np. `billingRollFailed`), więc i szansę.
- **Propozycja:** dla przebiegów `startup` wysyłać alarm z `track` w tle (jak start przypomnień), z testem, że start nie czeka na SMTP; e2e czekają na alarm przez odpowiednik `idle()`.
- **Gdzie:** nowa pozycja roadmapy M-2 (do dopisania przez `/10x-roadmap`) albo w S-14, jeśli i tak dotyka `JobRunService`.

## Poprawione w ramach przeglądu

F1, F2, F3, F4, F5 — zob. decyzje w raporcie.
