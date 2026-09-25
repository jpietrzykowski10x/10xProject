---
project: SubTracker
version: 1
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

## Success Criteria

### Primary
- Nowy użytkownik przechodzi od wejścia na stronę do pierwszej subskrypcji widocznej na liście (logowanie magic linkiem, dodanie subskrypcji z pełnymi szczegółami) w mniej niż 3 minuty.
- Sumy miesięczne i roczne na dashboardzie są zgodne z ręcznym wyliczeniem dla 100% wprowadzonych subskrypcji.

### Secondary
- Wykrywanie duplikatów/nakładających się subskrypcji w tej samej kategorii.
- Kontrola budżetu: limity maksymalne na kategorię oraz limit całościowy.

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

### Uwierzytelnianie i dostęp
- FR-001: Użytkownik może zalogować się za pomocą magic linku wysłanego na e-mail. Priority: must-have
  > Socrates: Counter-argument considered: "magic link wymaga zawsze dostępu do skrzynki e-mail — tarcie przy szybkim sprawdzeniu z telefonu bez dostępu do maila w danej chwili." Resolution: kept; FR-003 (login e-mail+hasło) istnieje jako nice-to-have fallback na wypadek niewygody magic linku.
- FR-002: Administrator może zarządzać kontami użytkowników (odblokowanie, reset dostępu) z pełnym wglądem w dane użytkownika. Priority: must-have
  > Socrates: Counter-argument considered: "pełny wgląd admina w dane finansowe zwiększa ryzyko wycieku wrażliwych danych." Resolution: kept; ryzyko świadomie zaakceptowane na MVP, zawężenie widoczności admina zaplanowane jako możliwe ograniczenie w v2 (patrz Access Control).
- FR-003: Użytkownik może zalogować się przy użyciu e-maila i hasła (alternatywa dla magic linku). Priority: nice-to-have
  > Socrates: Counter-argument considered: "może okazać się zbędne, jeśli magic link się sprawdzi." Resolution: kept jako nice-to-have; implementowane tylko jeśli starczy czasu, nie blokuje ukończenia MVP.

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

### Wykrywanie duplikatów
- FR-009: Użytkownik może ustawić konfigurowalny próg liczby aktywnych subskrypcji w danej kategorii (domyślnie: 2), po przekroczeniu którego system oznacza flagą/ostrzeżeniem na dashboardzie. Priority: must-have
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

## Non-Functional Requirements

- Aplikacja działa poprawnie na dwóch najnowszych wersjach głównych przeglądarek desktopowych.
- Pierwszy widok ładuje się w czasie zgodnym z ogólnie przyjętymi wytycznymi dla portali internetowych (LCP < 3.5s).
- Dane osobowe/finansowe użytkownika są usuwane lub anonimizowane w ciągu 30 dni od żądania usunięcia konta.
- Konta nieaktywne (brak logowania) przez 12 miesięcy są zgłaszane użytkownikowi do potwierdzenia dalszego przechowywania lub usunięcia danych.

## Business Logic

System pokazuje alert o wielu subskrypcjach tego samego typu oraz o zbliżaniu się do limitu budżetowego lub jego przekroczeniu.

Reguła bierze pod uwagę dane wprowadzone przez użytkownika: listę subskrypcji/płatności cyklicznych wraz z ich kategoriami i kwotami, oraz ustawiony budżet (całościowy i per kategoria). Wynikiem jest zmiana statusu poszczególnych kategorii subskrypcji (informacja o zbyt dużej liczbie lub zbyt wysokiej kwocie) oraz podsumowanie na dashboardzie — czy użytkownik mieści się w ustalonych limitach. Analiza wykonywana jest na żądanie oraz automatycznie po zakończonym wprowadzaniu lub edycji subskrypcji.

## Access Control

Logowanie oparte o magic link (e-mail) jako rozwiązanie MVP — bez przechowywania haseł, wymaga tylko wysyłki maili transakcyjnych (i tak potrzebnych do przypomnień o końcu triala). Pełne logowanie e-mail + hasło jest opcjonalnym rozszerzeniem — nice-to-have, do dodania jeśli starczy czasu w budżecie 8h/tydzień.

Role:
- **User** — widzi wyłącznie własne dane; informacje o subskrypcjach i finansach nie są publiczne ani widoczne dla innych userów.
- **Admin** — pełny wgląd w dane użytkowników (włącznie z subskrypcjami i kwotami), na potrzeby zarządzania kontami (odblokowanie, reset dostępu, gdy zawiodą standardowe opcje odzyskiwania). Świadomie przyjęte na MVP ze względu na czas wdrożenia; zawężenie widoczności admina do danych operacyjnych (bez wglądu w finanse) rozważane jako możliwe ograniczenie w v2, po fazie testów. Rolę admina nadaje ręcznie operator systemu poza aplikacją — nie ma samorejestracji jako administrator.

## Non-Goals

- **Scraping promocji od dostawców** — ryzyko techniczne/prawne (anti-bot, kwestie ToS); poza zakresem MVP.
- **Współdzielone subskrypcje / split kosztów** — backlog v2; MVP zakłada pojedynczego użytkownika na konto.
- **Rekomendacja przejścia na plan roczny** — backlog v2; poza podstawową logiką alertów i budżetu.
- **Historia zmian cen w czasie** — backlog v2; MVP pokazuje stan bieżący, nie trendy historyczne.
- **Obsługa wielu walut** — MVP operuje wyłącznie w PLN; subskrypcje w innych walutach użytkownik wprowadza po własnym przeliczeniu.

## Open Questions

Brak otwartych pytań blokujących. Luki wykryte w przeglądzie po wygenerowaniu PRD (daty w cyklu życia subskrypcji, termin przypomnienia, źródło kategorii, forma płatności, nadawanie roli admina, waluta, mierzalność kryterium Primary, spójność reguły biznesowej z Non-Goals) zostały rozstrzygnięte przez użytkownika 2026-09-25 i naniesione w odpowiednich sekcjach.
