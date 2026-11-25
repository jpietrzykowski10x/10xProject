# Follow-up S-15: komunikaty S5 i S6 oraz drobne porządki

S-15 zapisuje przyczynę tych błędów (`ErrorReporter`), ale nie zmienia tego, co widzi użytkownik. Do osobnego slice'a.

## S5: 400 przy tworzeniu kategorii wygląda jak awaria

- Gdzie: `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts` (tworzenie kategorii w formularzu, gałąź `error:` po `409`, ok. l. 253-260) i `frontend-subtracker/src/app/pages/budget/budget.ts` (panel „Nowa kategoria”, gałąź `error:` po `409`, ok. l. 431-440).
- Dziś: 400 (nazwa odrzucona przez walidację API) trafia do `else` razem z 5xx i sieciowym 0, więc pokazuje „nie udało się” i idzie do reportera.
- Do zrobienia: osobna gałąź 400 z komunikatem przy polu nazwy (jak `conflict` dla 409), bez raportu; test komponentu dla 400.

## S6: nieaktualne sumy bez znaku

- Gdzie: `frontend-subtracker/src/app/subscriptions/cost-totals.store.ts` (`fetch()`, gałąź `error:`, ok. l. 47-53).
- Dziś: nieudane odświeżenie przy stanie `ready` zostawia stare sumy i alerty budżetu bez żadnej informacji, że mogą być nieaktualne.
- Do zrobienia: flaga „odświeżenie nie powiodło się” w stanie store'a i dyskretny znak przy sumach (dashboard, lista), znikający po udanym odświeżeniu.

## Inne z S-15

- Middleware `Render` w `server.ts` (odrzucenie `handle()`) ma tylko testy jednostkowe `renderErrorLines`; żaden e2e nie sprawia, że `handle()` odrzuca.
