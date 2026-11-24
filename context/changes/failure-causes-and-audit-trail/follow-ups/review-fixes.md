# Follow-ups z przeglądu implementacji

Źródło: `context/changes/failure-causes-and-audit-trail/reviews/impl-review.md`.

Wszystkie ustalenia (F1–F6) poprawione w ramach tej zmiany; nic nie zostaje na później.

- F6 (start czekał na alarm joba, ryzyko cofnięcia deployu przy wiszącym SMTP): opcja 1 z rozmowy — alarm przebiegu `startup` w tle, `JobRunService.alertsSent()` czeka na niego przy zamknięciu i w `start()` pomocnika e2e; alarm przebiegu `cron` nadal awaitowany. Rozważone i odrzucone: cały przebieg startowy w tle (łamie „przejścia przed pierwszym żądaniem”), krótsze timeouty SMTP (nie usuwają ryzyka), odłożenie (ryzyko zostaje na produkcji).
- Zostaje do S-14: ujednolicenie linii `err.log`, które nadal niosą komunikat błędu bazy (F3, opisane w `backend-patterns.md`, „Logi błędów i odmów”).
