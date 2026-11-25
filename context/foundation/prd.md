---
project: SubTracker
version: 2
status: draft
created: 2026-09-25
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 7
  hard_deadline: 2026-12-06
  after_hours_only: true
---

# SubTracker — Product Requirements Document

## Vision & Problem Statement

Osoby fizyczne 18+, korzystające z wielu subskrypcji i wielu kart kredytowych/debetowych, tracą kontrolę nad swoimi cyklicznymi zobowiązaniami: nie zauważają końca okresów próbnych, płacą za nakładające się usługi i nie wiedzą, ile realnie wydają miesięcznie. Problem ujawnia się najdotkliwiej podczas przeglądu finansów osobistych lub w trakcie wniosku kredytowego, gdy okazuje się brak zdolności kredytowej — pieniądze "wyciekają" z konta co miesiąc, utrudniając spięcie budżetu i wyjście z długów.

Analiza historii transakcji bankowych wymaga czasu, którego większość użytkowników nie poświęca, a problemem nie jest pojedyncza płatność, lecz jej cykliczność i kumulacja — mała, kwartalna opłata za serwis niewykorzystywany od dwóch lat nie przyciąga uwagi w historii, ale suma wszystkich takich subskrypcji stanowi istotny procent przychodu. Istniejące alternatywy (arkusze Excel, menedżery finansowe, kategoryzacja w bankowości) tylko częściowo rozwiązują problem, bo wymagają ręcznej, regularnej pracy.

## User & Persona

Osoba fizyczna 18+, korzystająca z wielu subskrypcji i wielu kart kredytowych/debetowych (nie firma — tam kontrolę zapewnia księgowość). Sięga po narzędzie podczas przeglądu finansów osobistych lub przygotowań do wniosku kredytowego, gdy chce zrozumieć i ograniczyć swoje miesięczne zobowiązania cykliczne.

Od v2 drugą personą jest **operator** — właściciel i jedyna osoba utrzymująca aplikację na produkcji. Nie korzysta z osobnego interfejsu: o awariach dowiaduje się z maili alarmowych, a diagnozuje je z logów procesów.

## Success Criteria

### Primary
- Nowy użytkownik przechodzi od wejścia na stronę do pierwszej subskrypcji widocznej na liście (logowanie magic linkiem, dodanie subskrypcji z pełnymi szczegółami) w mniej niż 3 minuty.
- Sumy miesięczne i roczne na dashboardzie są zgodne z ręcznym wyliczeniem dla 100% wprowadzonych subskrypcji.

### Secondary
- Wykrywanie duplikatów/nakładających się subskrypcji w tej samej kategorii.
- Kontrola budżetu: limity maksymalne na kategorię oraz limit całościowy.
- (v2) O awarii API, zadania cyklicznego albo wysyłki maili operator dowiaduje się z alarmu, a nie od użytkownika; z jednej linii logu wie, której trasy, którego zadania i której wersji dotyczy błąd.

### Guardrails
- Prywatność danych finansowych — dane subskrypcyjne/finansowe użytkownika nie są publiczne ani widoczne dla innych userów.
- Izolacja kont — brak przecieku danych między kontami użytkowników.

## User Stories

### US-01: Użytkownik loguje się i dodaje pierwszą subskrypcję

- **Given** zarejestrowany użytkownik, bez wcześniej dodanych subskrypcji, z dostępem do swojej skrzynki e-mail
- **When** loguje się przez magic link i dodaje nową subskrypcję (nazwa, kategoria, kwota, cykl, forma płatności, status)
- **Then** subskrypcja pojawia się na liście subskrypcji użytkownika ze wszystkimi wprowadzonymi szczegółami

#### Acceptance Criteria
- Magic link jest ważny tylko przez ograniczony czas i tylko do jednorazowego użycia
- Nowo dodana subskrypcja jest natychmiast widoczna na liście
- Kwota subskrypcji jest przeliczana do wspólnego mianownika (miesięcznie/rocznie) na dashboardzie

## Functional Requirements

> **v2 (2026-11-22):** dopisane FR-019–FR-024 (poprawki po audycie obserwowalności `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md`; w notach ID ustaleń z raportu), FR-025 (edycja i usuwanie własnych kategorii) oraz FR-026–FR-027 (nice-to-have na koniec v2 albo do v3). Kolejność realizacji: najpierw FR-019–FR-024, zaraz po nich FR-025, potem nice-to-have z v1 (FR-016, FR-012, FR-017, FR-015, FR-003), na końcu FR-026, FR-027 i NFR o kontach nieaktywnych.

### Uwierzytelnianie i dostęp
- FR-001: Użytkownik może zalogować się za pomocą magic linku wysłanego na e-mail. Priority: must-have
  > Socrates: Counter-argument considered: "magic link wymaga zawsze dostępu do skrzynki e-mail — tarcie przy szybkim sprawdzeniu z telefonu bez dostępu do maila w danej chwili." Resolution: kept; FR-003 (login e-mail+hasło) istnieje jako nice-to-have fallback na wypadek niewygody magic linku.
- FR-002: Administrator może zarządzać kontami użytkowników (odblokowanie, reset dostępu) z pełnym wglądem w dane użytkownika. Priority: must-have
  > Socrates: Counter-argument considered: "pełny wgląd admina w dane finansowe zwiększa ryzyko wycieku wrażliwych danych." Resolution: kept; ryzyko świadomie zaakceptowane na MVP, zawężenie widoczności admina zaplanowane jako możliwe ograniczenie w v2 (patrz Access Control).
- FR-003: Użytkownik może zalogować się przy użyciu e-maila i hasła (alternatywa dla magic linku). Priority: nice-to-have
  > Socrates: Counter-argument considered: "może okazać się zbędne, jeśli magic link się sprawdzi." Resolution: kept jako nice-to-have; implementowane tylko jeśli starczy czasu, nie blokuje ukończenia MVP.
- FR-027: Użytkownik dostaje e-mail, gdy ktoś zaloguje się na jego konto z nieznanego urządzenia; link „to nie ja” w tym mailu blokuje konto (mechanizm blokady z FR-002), a urządzenia, z których już się logował, są zapamiętane jako zaufane. Priority: nice-to-have (koniec v2 albo v3)

### Zarządzanie subskrypcjami
- FR-004: Użytkownik może dodać nową subskrypcję: nazwa, kategoria, kwota w PLN, cykl rozliczeniowy miesięczny/roczny, forma płatności (z zamkniętej listy: karta kredytowa, karta debetowa, BLIK, przelew/zlecenie stałe, portfel elektroniczny, inne), status, data końca okresu próbnego (dla subskrypcji w trialu) i data następnego rozliczenia. Priority: must-have
  > Socrates: Counter-argument considered: "sztywne pole karta/bank nie pasuje do każdej subskrypcji (np. płatność BLIK-iem bez przypisanej karty)." Resolution: zmieniono pole z "karta/bank" na "forma płatności" — pole wymagane, ograniczone do form cyklicznych płatności dostępnych na rynku (tekstowe lub lista wyboru), zamiast wskazania konkretnej karty.
- FR-005: Użytkownik może edytować istniejącą subskrypcję; zmiana danych wymusza ponowne przeliczenie budżetu i analizy duplikatów. Priority: must-have
  > Socrates: Counter-argument considered: "edycja może zafałszować historię dla analizy budżetu/duplikatów w czasie." Resolution: odrzucony — użytkownik musi móc poprawić własne dane; zamiast blokować edycję, FR doprecyzowany o wymóg ponownego przeliczenia po zmianie.
- FR-006: Użytkownik może usunąć błędnie dodaną subskrypcję (twarde usunięcie) — odrębne od anulowania subskrypcji przez cykl życia (patrz FR-013). Priority: must-have
  > Socrates: Counter-argument considered: "twarde usunięcie bezpowrotnie kasuje historię, lepiej jako anulowanie." Resolution: obie operacje potrzebne do różnych celów — usunięcie dla pomyłkowo dodanych wpisów, anulowanie (FR-013) dla realnej rezygnacji z usługi z zachowaniem historii.
- FR-007: Użytkownik może przeglądać listę wszystkich swoich subskrypcji w jednej tabeli ze szczegółami. Priority: must-have
  > Socrates: Counter-argument considered: "bez sortowania/filtrowania lista staje się nieużyteczna przy większej liczbie subskrypcji." Resolution: bazowa lista zostaje must-have; sortowanie/filtrowanie wydzielone jako osobny FR-016 (nice-to-have, planowane na v2/v3).
- FR-008: System przelicza koszt każdej subskrypcji do wspólnego mianownika i pokazuje na dashboardzie zarówno sumę miesięczną, jak i roczną, z podziałem na kategorie. Priority: must-have
  > Socrates: Counter-argument considered: "uśredniona kwota roczna może wprowadzać w błąd." Resolution: odrzucony i rozszerzony — dashboard pokazuje oba podsumowania (miesięczne i roczne), co pomaga porównać koszt np. z wypłatą.
- FR-016: Użytkownik może sortować i filtrować listę subskrypcji. Priority: nice-to-have (planowane na v2/v3)
- FR-018: Użytkownik może wybrać kategorię subskrypcji z predefiniowanej listy lub dodać własną. Priority: must-have
- FR-025: Użytkownik może zmienić nazwę własnej kategorii albo ją usunąć (np. błędnie wpisaną); kategorii predefiniowanych nie zmienia. Usunąć można tylko kategorię bez subskrypcji; próba usunięcia niepustej kończy się czytelnym komunikatem (nie błędem serwera) i nie rusza jej subskrypcji, a unikalność nazw, progi duplikatów (FR-009) i limity budżetu (FR-010) pozostają spójne. Priority: must-have
  > Socrates: Counter-argument considered: "użytkownik może po prostu nie używać błędnej kategorii." Resolution: odrzucony — błędna kategoria zostaje na zawsze na liście wyboru, w podziale dashboardu i na stronie budżetu, a administrator nie edytuje danych użytkownika, więc nie ma innej drogi jej usunięcia.
- FR-026: Forma płatności na liście subskrypcji jest pokazana ikoną z etykietą tekstową dla czytników ekranu zamiast samego tekstu. Priority: nice-to-have (koniec v2 albo v3)

### Wykrywanie duplikatów
- FR-009: Użytkownik może ustawić konfigurowalny próg liczby aktywnych subskrypcji w danej kategorii (domyślnie: 3; zmienione z 2 w S-07 — przy 2 ostrzeżenie zapalało się zbyt wcześnie i traciło sens), po przekroczeniu którego system oznacza flagą/ostrzeżeniem na dashboardzie. Priority: must-have
  > Socrates: Counter-argument considered: "sztywna reguła 2+ generuje dużo fałszywych pozytywów — np. 2 subskrypcje AI to realny problem, ale 4 streamingowe mogą być świadomym wyborem." Resolution: przyjęty — próg staje się konfigurowalny per kategoria, zamiast jednej sztywnej wartości dla wszystkich.

### Budżet i alerty
- FR-010: Użytkownik może ustawić miesięczny limit budżetowy całościowy oraz limity dla poszczególnych kategorii. Priority: must-have
  > Socrates: Counter-argument considered: "dwupoziomowy limit to więcej pracy niż jeden całościowy." Resolution: brak kontrargumentu — FR stoi bez zmian.
- FR-011: System oblicza sumę aktywnych subskrypcji vs limit i wyświetla alert przy przekroczeniu progów (np. 80%, 100%). Priority: must-have
  > Socrates: Counter-argument considered: "sztywne progi 80/100% nie pasują każdemu — część userów chce innej konfiguracji." Resolution: uznany za trafny, ale odsunięty — progi zostają stałe (80%/100%) w MVP; konfigurowalne progi wydzielone jako FR-017 (nice-to-have, v2).
- FR-012: System pokazuje prognozę ("jeśli dodasz tę subskrypcję, przekroczysz budżet o X zł") przed dodaniem nowej subskrypcji. Priority: nice-to-have
  > Socrates: Counter-argument considered: "dodatkowa złożoność UX w formularzu dodawania, gdy alert po dodaniu (FR-011) już informuje o przekroczeniu." Resolution: przyjęty — zdegradowany z must-have do nice-to-have, może zjechać do v2, jeśli zabraknie czasu.
- FR-017: Użytkownik może konfigurować własne progi alertów budżetowych zamiast domyślnych 80%/100%. Priority: nice-to-have (planowane na v2)

### Cykl życia subskrypcji
- FR-013: Subskrypcja przechodzi przez stany trial → active → cancelled_pending → cancelled z logiką przejść między nimi: trial → active po dacie końca okresu próbnego; cancelled_pending → cancelled po dacie następnego rozliczenia (koniec opłaconego okresu). Priority: must-have
  > Socrates: Counter-argument considered: "ręczne zarządzanie statusem przez użytkownika może wystarczyć, bez formalnej maszyny stanów w kodzie." Resolution: odrzucony — to kluczowa reguła domenowa MVP; formalna maszyna stanów (z automatycznymi przejściami, np. przypomnieniem przed końcem triala) zostaje, bo bez niej cykl życia sprowadza się do zwykłego pola statusu.
- FR-014: System wysyła przypomnienie e-mail 7 dni przed końcem okresu próbnego. Priority: must-have
  > Socrates: Counter-argument considered: "wymaga schedulera/cron sprawdzającego zbliżające się końce triali — jeden z bardziej czasochłonnych elementów MVP." Resolution: brak kontrargumentu odrzucającego FR — zostaje jak jest, koszt czasowy już uwzględniony w akceptacji 6-7-tygodniowego terminu.

### Powiadomienia okresowe
- FR-015: System wysyła okresowy e-mail podsumowujący, jeśli którekolwiek alerty są aktywne (np. 2+ subskrypcje w tej samej kategorii, przekroczony próg budżetowy). Priority: nice-to-have
  > Socrates: Counter-argument considered: "druga funkcja mailowa obok przypomnień o trialu to dodatkowy nakład na infrastrukturę i harmonogram." Resolution: brak kontrargumentu odrzucającego FR — zostaje jak jest, jako nice-to-have.

### Niezawodność i diagnostyka (operator, v2)
- FR-019: Operator dostaje e-mail, gdy API przestaje odpowiadać albo pada w pętli restartów (sprawdzenie spoza procesu API, działa także, gdy API leży), oraz gdy zadanie cykliczne zakończy się błędem albo nie zakończy się w ciągu 26 godzin; każdy przebieg zadania zostawia trwały ślad (start, koniec, wynik, liczniki). Priority: must-have
  > Audyt: P1, J1, J2, J3, J4 (3 z 4 ustaleń krytycznych); odpowiada na pytanie roadmapy o minimalny alarm. Mail alarmowy nie zawiera danych użytkowników — tylko zadanie, dzień, wynik i liczniki.
- FR-020: Alarm do operatora dochodzi także wtedy, gdy nie działa wysyłka maili do użytkowników: na produkcji wymagany jest osobny kanał alarmowy, blokada powtórzeń zaczyna działać dopiero po przyjęciu alarmu, a odrzucenie adresata przez serwer pocztowy (np. relay, limit wysyłki) jest odróżnione od literówki w adresie. Priority: must-have
  > Audyt: L2, L3, J6, J10.
- FR-021: Każdy błąd serwera w logu API zawiera metodę, szablon trasy, identyfikator użytkownika i identyfikator żądania; wybrane odmowy 4xx (weryfikacja linku logowania, sesja, CSRF/Origin, ranga administratora, walidacja) zostawiają linię z kodem przyczyny i nazwami pól — bez wartości, adresów e-mail, tokenów i parametrów zapytania — z limitem, żeby obcy ruch nie rozdmuchał logu. Priority: must-have
  > Audyt: L1 (krytyczne), L7, P2, P5, P12, S1, S3, S4, A1, A2, A4.
- FR-022: Logi obu procesów mają jednolity format bez kodów kolorów, ze znacznikiem czasu ISO ze strefą; linia startowa i `/health` podają wdrożoną wersję; każde żądanie zostawia jedną linię access logu (metoda, trasa, status, czas). Priority: must-have
  > Audyt: P3, P4, P6.
- FR-023: Błąd w przeglądarce albo przy renderowaniu na serwerze nie znika bez śladu: strony i formularze nie zamieniają nieznanego błędu w ogólny komunikat bez zapisu przyczyny, błąd nawigacji przy renderowaniu na serwerze nie wygląda jak 404, a nieaktualny plik aplikacji po wdrożeniu przeładowuje stronę zamiast zostawić martwy link. Priority: must-have
  > Audyt: L4, L5, L6, S5, S6, S7, A9, P7, P8. Wysyłanie błędów z przeglądarki do API dopiero po decyzji z Open Questions #2.
- FR-024: Zadania cykliczne i wysyłka maili rozróżniają przyczyny porażki (brak konta, konto zablokowane, błąd bazy, błąd SMTP) zamiast jednego wyniku „nie udało się”, a usunięcie konta, odmowy akcji administratora i jego wyszukiwania zostawiają ślad audytowy. Priority: must-have
  > Audyt: §6 pkt 6–7 raportu (J5, J7–J9, J11, J15, L8, A3, A5–A8). Drobne poprawki z §6 pkt 8 wchodzą przy okazji slice'u, który dotyka danego kodu.

## Non-Functional Requirements

- Aplikacja działa poprawnie na dwóch najnowszych wersjach głównych przeglądarek desktopowych.
- Pierwszy widok ładuje się w czasie zgodnym z ogólnie przyjętymi wytycznymi dla portali internetowych (LCP < 3.5s).
- Dane osobowe/finansowe użytkownika są usuwane lub anonimizowane w ciągu 30 dni od żądania usunięcia konta.
- Konta nieaktywne (brak logowania) przez 12 miesięcy są zgłaszane użytkownikowi do potwierdzenia dalszego przechowywania lub usunięcia danych. (Realizacja: koniec v2 albo v3 — pierwsze takie konta pojawią się najwcześniej rok po starcie.)

## Business Logic

System pokazuje alert o wielu subskrypcjach tego samego typu oraz o zbliżaniu się do limitu budżetowego lub jego przekroczeniu.

Reguła bierze pod uwagę dane wprowadzone przez użytkownika: listę subskrypcji/płatności cyklicznych wraz z ich kategoriami i kwotami, oraz ustawiony budżet (całościowy i per kategoria). Wynikiem jest zmiana statusu poszczególnych kategorii subskrypcji (informacja o zbyt dużej liczbie lub zbyt wysokiej kwocie) oraz podsumowanie na dashboardzie — czy użytkownik mieści się w ustalonych limitach. Analiza wykonywana jest na żądanie oraz automatycznie po zakończonym wprowadzaniu lub edycji subskrypcji.

## Access Control

Logowanie oparte o magic link (e-mail) jako rozwiązanie MVP — bez przechowywania haseł, wymaga tylko wysyłki maili transakcyjnych (i tak potrzebnych do przypomnień o końcu triala). Pełne logowanie e-mail + hasło jest opcjonalnym rozszerzeniem — nice-to-have, do dodania jeśli starczy czasu w budżecie 8h/tydzień.

Role:
- **User** — widzi wyłącznie własne dane; informacje o subskrypcjach i finansach nie są publiczne ani widoczne dla innych userów.
- **Admin** — pełny wgląd w dane użytkowników (włącznie z subskrypcjami i kwotami), na potrzeby zarządzania kontami (odblokowanie, reset dostępu, gdy zawiodą standardowe opcje odzyskiwania). Świadomie przyjęte na MVP ze względu na czas wdrożenia; zawężenie widoczności admina do danych operacyjnych (bez wglądu w finanse) rozważane jako możliwe ograniczenie w v2, po fazie testów. Rolę admina nadaje ręcznie operator systemu poza aplikacją — nie ma samorejestracji jako administrator. Admin tylko przegląda dane (bez edycji), blokuje i odblokowuje konta zwykłych użytkowników oraz wylogowuje je ze wszystkich urządzeń („reset dostępu”); każda taka akcja i każde otwarcie danych konta trafia do audytu. Nikt nie zarządza własnym kontem.
- **Superadmin** (S-09) — jedna osoba, nadawana i odbierana przez operatora tak jak Admin. Ma uprawnienia admina i dodatkowo może blokować, odblokowywać i wylogowywać adminów; superadminem nie zarządza nikt. API nie pokazuje innym, kto jest superadminem.

Zablokowane konto nie może się zalogować, a jego sesje i linki logowania przestają działać. Przy próbie logowania właściciel widzi komunikat, że konto jest zablokowane, z adresem kontaktowym, i dostaje mail o blokadzie (najwyżej raz na godzinę, żeby powtarzane próby nie zalewały skrzynki). To świadomy wyjątek od zasady jednakowej odpowiedzi dla każdego adresu: ujawnia się tylko to, że adres jest zablokowany, a adres aktywny i nieznany dostają tę samą odpowiedź. Odblokowanie na MVP: kontakt z administratorem. Joby i maile pomijają zablokowane konta (poza mailami o samej blokadzie, odblokowaniu i resecie).

## Non-Goals

- **Scraping promocji od dostawców** — ryzyko techniczne/prawne (anti-bot, kwestie ToS); poza zakresem MVP.
- **Współdzielone subskrypcje / split kosztów** — backlog v2; MVP zakłada pojedynczego użytkownika na konto.
- **Rekomendacja przejścia na plan roczny** — backlog v2; poza podstawową logiką alertów i budżetu.
- **Historia zmian cen w czasie** — backlog v2; MVP pokazuje stan bieżący, nie trendy historyczne.
- **Obsługa wielu walut** — MVP operuje wyłącznie w PLN; subskrypcje w innych walutach użytkownik wprowadza po własnym przeliczeniu.

## Open Questions

1. ~~**FR-025: co dzieje się z subskrypcjami usuwanej kategorii?**~~ Rozstrzygnięte 2026-11-22: usunąć można tylko pustą kategorię (bez subskrypcji); przy niepustej użytkownik dostaje komunikat, że najpierw musi przenieść albo usunąć jej subskrypcje.
2. **FR-023: czy błędy z przeglądarki mają trafiać do API?** Wymaga decyzji o limicie i o tym, jakie dane (adres strony, komunikat) wolno zapisać bez danych osobowych. Do decyzji FR-023 obejmuje tylko zapis w konsoli przeglądarki i w logu serwera SSR. Owner: user.

v1: brak otwartych pytań blokujących. Luki wykryte w przeglądzie po wygenerowaniu PRD (daty w cyklu życia subskrypcji, termin przypomnienia, źródło kategorii, forma płatności, nadawanie roli admina, waluta, mierzalność kryterium Primary, spójność reguły biznesowej z Non-Goals) zostały rozstrzygnięte przez użytkownika 2026-09-25 i naniesione w odpowiednich sekcjach.
