# Fundament interfejsu (ui-foundation) — plan implementacji

## Overview

Wprowadzamy Angular Material 22 z motywem projektu (kierunek F2 z makiet), szkielety stron na desktop i telefon, przenosimy istniejące ekrany S-01 na komponenty Materiala i budujemy nową, prerenderowaną stronę startową. Dzięki temu S-02 i kolejne slice'y powstają od razu w docelowym wyglądzie, bez przeróbek. Backend i API się nie zmieniają.

## Current State Analysis

Frontend ma tylko ekrany S-01 i wspólny, roboczy arkusz stylów. Nie ma biblioteki UI, szkieletu strony ani wersji na telefon. Logika formularzy (Reactive Forms, stany w sygnałach) jest gotowa i zostaje.

Makiety i decyzje projektowe: `context/changes/ui-foundation/change.md` (sekcja Notes) oraz płótno https://claude.ai/artifact/1GnVVi4MbScvb9CFMBT53J, rząd F2 (plansze `F2-Lista`, `F2-Rejestracja`, `F2-Tel-*`, `F2-Start`). Płótno jest prywatne i dostępne dla właściciela; w razie wątpliwości rozstrzyga ten plan i `change.md`.

## Desired End State

- Wszystkie ekrany mają wygląd F2: granat `#14284B`, zieleń `#0B6B4D` na głównych akcjach, IBM Plex Sans serwowany z własnego serwera, pola Materiala z etykietą na obramowaniu i promieniem 4 px.
- `/register`, `/sign-in`, `/auth/verify`, `/privacy-policy`, `/unavailable` mają układ publiczny: granatowa kolumna po lewej, treść po prawej; na telefonie kolumna staje się nagłówkiem nad treścią.
- `/subscriptions` ma szkielet zalogowanego: granatowa kolumna z nazwą aplikacji, nawigacją, e-mailem i „Wyloguj”; na telefonie nagłówek z menu. Treść to pusty stan listy.
- `/` to nowa strona startowa, prerenderowana, z treścią widoczną bez JavaScriptu. Zalogowany jest przekierowywany na `/subscriptions` w przeglądarce.
- Motyw obejmuje też komponenty, których użyje S-02 (select, table, button-toggle, sidenav), ale tych komponentów jeszcze nie budujemy.

Weryfikacja: build z prerenderem, paczka deployu, brak żądań do Google, testy ręczne na desktopie i telefonie, na końcu na produkcji.

### Key Discoveries:

- `frontend-subtracker/src/app/app.html` to samo `<router-outlet />`, a `app.config.ts` nie ma `provideAnimations` (Material 22 go nie wymaga).
- `frontend-subtracker/src/styles.scss:1-58`: globalne klasy `.page`, `.field`, `.checkbox`, `.field-error`, `.message`, używane przez wszystkie strony; po migracji mają zniknąć.
- `frontend-subtracker/src/app/app.routes.server.ts`: `''`, `register`, `sign-in`, `auth/verify`, `subscriptions` w `RenderMode.Client`, reszta (`privacy-policy`, `unavailable`) w `Prerender`.
- `frontend-subtracker/src/app/auth/auth.guard.ts:12-22`: `guestGuard` woła `session()` z limitem 3 s i przy błędzie przepuszcza. W prerenderze nie ma sesji ani API, więc na serwerze guard musi przepuścić od razu.
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts`: wylogowanie i jego błąd żyją w stronie listy; przenoszą się do szkieletu zalogowanego.
- `frontend-subtracker/angular.json`: budżety `initial` 500 kB ostrzeżenie / 1 MB błąd, `anyComponentStyle` 4 kB / 8 kB.
- Angular Material 22.2.6 (peer: Angular `^22.0.0`) ma `mat.theme`, `mat.theme-overrides`, `button-overrides` (`filled-container-shape` i inne), `form-field-overrides` (`outlined-container-shape`), `button-toggle-overrides`, `select-overrides`, `table-overrides`, `sidenav` z trybami `side`/`over`/`push` oraz schemat `ng generate @angular/material:theme-color`. Sprawdzone w paczce npm 2026-11-10.
- `@fontsource/ibm-plex-sans` 5.3.0, licencja OFL-1.1.

## What We're NOT Doing

- Formularza dodawania, listy, panelu dodawania i przełącznika panelu przy 1200 px: to S-02.
- Sum, limitu, kategorii i ostrzeżeń w kolumnie: to S-04, S-07, S-08. Kolumna pokazuje tylko to, co działa.
- Pozycji „Budżet” w nawigacji, dopóki nie ma tej strony.
- Rozwijanego wiersza listy na telefonie: zapisany w `change.md` dla S-02/S-03.
- Trybu ciemnego, ikon Materiala (font ikon ładuje się z Google; ikony to inline SVG), `ng add @angular/material`.
- CSP i zmian w backendzie, w tym CSRF (osobny bloker S-02).
- Testów automatycznych frontendu: projekt nie ma celu `ng test`, strategia testów przychodzi w Module 3.
- Treści polityki prywatności: zostaje obecny tekst zastępczy.

## Implementation Approach

Material instalujemy przez `npm install`, nie `ng add`, bo `ng add` dopisuje do `index.html` czcionki i ikony z Google. Cały wygląd Materiala ustawia jeden plik motywu: kolory przez `mat.theme` i `mat.theme-overrides`, kształty przez pojedyncze `*-overrides`. Układy specyficzne dla aplikacji (kolumna, nagłówek na telefonie, komunikaty) to dwa komponenty szkieletu z własnym SCSS. Strony przechodzą na komponenty Materiala bez zmian w logice i stanach.

Kolejność faz pozwala zbudować i obejrzeć aplikację po każdej z nich: najpierw motyw (nic się jeszcze nie przestawia), potem szkielety, potem ekrany, na końcu strona startowa z jej ryzykiem renderowania.

## Critical Implementation Details

- **Kolor przycisków głównych:** motyw M3 ma jeden kolor `primary`. Primary to granat (pola, checkboxy, fokus, zaznaczenie w przełącznikach), a zieleń dostają wyłącznie przyciski `mat-flat-button` przez `button-overrides` (`filled-container-color`, `filled-label-text-color`). Akcje drugorzędne używają `mat-stroked-button` albo `mat-button`, więc nie zrobią się zielone. Schemat `theme-color` generuje paletę tonalną, w której ton 40 nie jest dokładnie `#14284B`; dokładny granat ustawia `mat.theme-overrides((primary: #14284B, on-primary: #FFFFFF))`.
- **Prerender `/` a zalogowany użytkownik:** HTML z builda jest widoczny od razu, a przekierowanie następuje dopiero po starcie aplikacji i odpowiedzi `GET /auth/session`. Próg z decyzji użytkownika: zalogowany widzi stronę startową krócej niż 1 s (mediana z 5 przeładowań, DevTools, bez throttlingu). Mierzymy go tylko na produkcji (5.6): lokalny build produkcyjny woła produkcyjne API (`environment.ts`), które nie wpuszcza localhost w CORS i nie widzi lokalnej sesji, więc lokalnie sprawdzamy tylko, że przekierowanie działa. Jeśli próg nie przejdzie, `/` przechodzi na `RenderMode.Server` (szczegóły w fazie 4) i idzie drugi deploy.
- **Kolumna i nagłówek na telefonie:** przełączenie przez media query przy 840 px (granica klasy okna „medium” w Materialu), bez `BreakpointObserver`, żeby prerender i pierwszy render były poprawne bez JavaScriptu.

## Phase 1: Material, motyw i czcionka

### Overview

Instalacja zależności i motyw. Po tej fazie aplikacja wygląda prawie jak dotąd, ale ma już czcionkę, kolory systemowe Materiala i gotowe tokeny dla kolejnych faz.

### Changes Required:

#### 1. Zależności

**File**: `frontend-subtracker/package.json`, `package-lock.json`

**Intent**: Dodać Angular Material, CDK i lokalną czcionkę.

**Contract**: `@angular/material` i `@angular/cdk` w wersji zgodnej z `@angular/core` (22.2.x), `@fontsource/ibm-plex-sans` (^5.3.0) w `dependencies`. Bez `ng add`.

#### 2. Paleta i motyw

**File**: `frontend-subtracker/src/styles/_theme-colors.scss` (wygenerowany), `frontend-subtracker/src/styles/_theme.scss` (nowy), `frontend-subtracker/src/styles.scss`

**Intent**: Jeden plik motywu dla całej aplikacji, z kolorami F2 i kształtami z makiet.

**Contract**:
- Paleta z `ng generate @angular/material:theme-color` z primary `#14284B` i tertiary `#0B6B4D`, zapisana w `src/styles/`.
- Na `html`: `color-scheme: light`, `mat.theme` z tą paletą, `theme-type: light`, typografią `plain-family` i `brand-family` = `'IBM Plex Sans'`; `mat.theme-overrides` z dokładnym `primary: #14284B`, `on-primary: #FFFFFF`.
- Kształty 4 px: `form-field-overrides` (`outlined-container-shape`), `button-overrides` (kształty filled, outlined, text, protected), `button-toggle-overrides`, `select-overrides` dla panelu.
- Przyciski `mat-flat-button`: tło `#0B6B4D`, tekst `#FFFFFF`, wysokość 48 px przez `button-overrides` (`filled-container-color`, `filled-label-text-color`, `filled-container-height: 48px`).
- Pola `mat-form-field` w wariancie `outline` domyślnie (`MAT_FORM_FIELD_DEFAULT_OPTIONS` w `app.config.ts`, `appearance: 'outline'`), wysokość 48 px przez `mat.form-field-density(-2)`. Gęstości nie ustawiamy w `mat.theme`, bo zmieniłaby wszystkie komponenty, także przyciski i checkboxy.
- Kolory semantyczne jako zmienne CSS na `:root`: `--st-navy`, `--st-green`, `--st-warning-bg` `#FDF1DC`, `--st-warning-text` `#6B4100`, `--st-success-bg`, `--st-success-text`, `--st-error-bg`, `--st-error-text` (kontrast co najmniej 4.5:1), `--st-muted` `#4F5D6C`, `--st-line` `#D5DCE3`, `--st-page` `#F3F5F7`.

#### 3. Czcionka

**File**: `frontend-subtracker/src/styles.scss` albo `frontend-subtracker/angular.json` (`styles`)

**Intent**: IBM Plex Sans z paczki, w wagach 400, 500, 600, 700, z polskimi znakami.

**Contract**: import plików CSS `@fontsource/ibm-plex-sans` dla tych wag. W zbudowanym `dist/` nie ma odwołań do `fonts.googleapis.com` ani `fonts.gstatic.com`, a pliki `.woff2` trafiają do `browser/` i do paczki `.mydevil/public/`.

#### 4. Globalne style bazowe

**File**: `frontend-subtracker/src/styles.scss`

**Intent**: Bazowe tło, kolor tekstu, `tabular-nums` dla kwot (klasa pomocnicza) i widoczny fokus. Stare klasy (`.page`, `.field`, `.checkbox`, `.field-error`, `.message`) zostają do fazy 3, bo używają ich jeszcze strony.

**Contract**: `body` z czcionką z motywu i tłem `--st-page`; klasa `.st-amount` z `font-variant-numeric: tabular-nums`.

### Success Criteria:

#### Automated Verification:

- Build produkcyjny z prerenderem przechodzi bez błędów budżetu: `cd frontend-subtracker && npm run build`
- Paczka deployu buduje się i zawiera pliki `.woff2`: `npm run prepare-mydevil`
- Zbudowane pliki nie odwołują się do Google Fonts: brak trafień `fonts.googleapis.com` i `fonts.gstatic.com` w `dist/`

#### Manual Verification:

- `npm start`: strony S-01 działają jak dotąd, tekst jest w IBM Plex Sans (DevTools, Computed font), a w zakładce Network nie ma żądań do Google

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 2: Szkielety stron

### Overview

Dwa komponenty układu: publiczny i zalogowanego, każdy na desktop i telefon. Strony zaczynają z nich korzystać, ale ich własna treść zmienia się dopiero w fazie 3.

### Changes Required:

#### 1. Układ publiczny

**File**: `frontend-subtracker/src/app/layout/public-layout/` (komponent `PublicLayout`)

**Intent**: Granatowa kolumna z nazwą aplikacji (link do `/`) i opcjonalną treścią boczną oraz obszar treści po prawej. Na telefonie kolumna jest nagłówkiem nad treścią (makieta `F2-Tel-Rejestracja`).

**Contract**: selektor `app-public-layout`; treść boczna przez `<ng-content select="[layoutAside]">`, główna przez domyślne `<ng-content>`. Kolumna ma `flex: 1 1 300px` na desktopie; poniżej 840 px układ kolumnowy. Element `<main>` jest w layoucie, strony nie dodają własnego.

#### 2. Szkielet zalogowanego

**File**: `frontend-subtracker/src/app/layout/app-shell/` (komponent `AppShell`)

**Intent**: Granatowa kolumna (nazwa aplikacji, nawigacja z „Subskrypcje”, e-mail zalogowanego, „Wyloguj”) i obszar treści. Na telefonie nagłówek z nazwą i przyciskiem menu (`mat-menu`: Subskrypcje, e-mail, Wyloguj), makieta `F2-Tel-Lista` bez sum.

**Contract**: selektor `app-shell`, treść przez `<ng-content>`. Wylogowanie przenosi się tu z `Subscriptions`: te same sygnały `loggingOut`, `logoutFailed`, ten sam komunikat błędu i przekierowanie na `/sign-in`. Link „Subskrypcje” ma `aria-current="page"`. Przycisk menu ma `aria-label="Menu"`; ikona to inline SVG z `aria-hidden="true"`. Przejście kolumna ↔ nagłówek przy 840 px przez media query.

#### 3. Podpięcie stron

**File**: strony w `frontend-subtracker/src/app/pages/*/`

**Intent**: Strony publiczne (`register`, `sign-in`, `verify-link`, `privacy-policy`, `service-unavailable`) i `subscriptions` są owinięte w odpowiedni układ, a ich własny `<main class="page">` znika. Strona `home` zostaje bez zmian do fazy 4.

**Contract**: treść boczna kolumny: rejestracja, logowanie i potwierdzenie linku pokazują „Bez hasła” i zdanie o linku ważnym 15 minut, którego można użyć raz; polityka i niedostępność tylko nazwę aplikacji.

### Success Criteria:

#### Automated Verification:

- Build przechodzi bez błędów budżetu, także `anyComponentStyle` (8 kB): `npm run build`
- Prerenderowane `/privacy-policy` i `/unavailable` zawierają granatową kolumnę w HTML (`dist/frontend-subtracker/browser/privacy-policy/index.html`)

#### Manual Verification:

- Na desktopie strony publiczne i `/subscriptions` mają kolumnę po lewej, zgodnie z makietami F2
- Przy szerokości poniżej 840 px i na telefonie (DevTools, 390 px) kolumna zamienia się w nagłówek, bez poziomego przewijania strony
- Menu na telefonie otwiera się, a „Wyloguj” z menu i z kolumny wylogowuje; przy wyłączonym API pojawia się dotychczasowy komunikat błędu
- Klawiatura: Tab przechodzi przez nawigację, menu i „Wyloguj” w logicznej kolejności, fokus jest widoczny

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 3: Ekrany S-01 na Materialu

### Overview

Formularze i komunikaty przechodzą na komponenty Materiala i style z motywu. Logika, walidatory, stany i teksty komunikatów zostają.

### Changes Required:

#### 1. Rejestracja i logowanie

**File**: `frontend-subtracker/src/app/pages/register/`, `frontend-subtracker/src/app/pages/sign-in/`

**Intent**: Pole e-mail jako `mat-form-field` z `mat-label` i `matInput`, błąd jako `mat-error`; zgody jako `mat-checkbox`; przycisk `mat-flat-button`. Makieta `F2-Rejestracja`.

**Contract**:
- Błąd pola e-mail pokazuje się według domyślnej reguły Materiala: po opuszczeniu pola albo po wysłaniu formularza. Komunikat bez zmian: „Podaj poprawny adres e-mail.”
- Błędy zgód (`mat-checkbox` nie ma `mat-error`) zostają jak dziś: tekst pod polem po wysłaniu, połączony przez `aria-describedby`.
- Stany `sent`, `invalid`, `unavailable` pokazują komunikaty w stylu z motywu (`--st-success-*`, `--st-error-*`), z dotychczasowymi `role="status"` / `role="alert"` i tekstami.
- Przycisk zablokowany w stanie `sending`, jak dziś.

#### 2. Potwierdzenie linku, polityka, niedostępność

**File**: `frontend-subtracker/src/app/pages/verify-link/`, `privacy-policy/`, `service-unavailable/`

**Intent**: Te same teksty w nowym układzie; „Zaloguj” jako `mat-flat-button`, „Poproś o nowy link” jako link.

**Contract**: bez zmian w logice `VerifyLink` i w kolejności żądań (token zużywa tylko `POST`).

#### 3. Lista subskrypcji (pusty stan)

**File**: `frontend-subtracker/src/app/pages/subscriptions/`

**Intent**: Nagłówek „Twoje subskrypcje” i pusty stan „Nie masz jeszcze żadnych subskrypcji.” w obszarze treści szkieletu. Bez przycisku dodawania: pojawi się w S-02.

**Contract**: komponent nie zawiera już logiki wylogowania (jest w `AppShell`).

#### 4. Sprzątanie stylów

**File**: `frontend-subtracker/src/styles.scss`

**Intent**: Usunąć klasy z roboczego arkusza, których już nic nie używa.

**Contract**: w `src/app/` nie ma odwołań do `.page`, `.field`, `.checkbox`, `.field-error`, `.message`.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Paczka deployu przechodzi: `npm run prepare-mydevil`
- Brak odwołań do starych klas w `frontend-subtracker/src/app/` (wyszukiwanie `class="page"`, `field-error`, `message--`)

#### Manual Verification:

- Pełny przepływ lokalnie z prawdziwym API: rejestracja → link → „Zaloguj” → pusta lista → „Wyloguj”
- Błędy: zły adres (`a@b`), brak zgód, wyłączone API dają te same komunikaty co przed zmianą, w nowym stylu
- Czytnik ekranu albo drzewo dostępności w DevTools: pola mają etykiety, błędy są powiązane z polami, komunikaty mają `role`
- Konsola przeglądarki bez błędów hydratacji na `/privacy-policy` i `/unavailable`

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 4: Strona startowa

### Overview

Nowa treść i układ `/` według makiety `F2-Start`, prerender tej trasy i obsługa zalogowanego użytkownika.

### Changes Required:

#### 1. Strona startowa

**File**: `frontend-subtracker/src/app/pages/home/`

**Intent**: Strona według makiety `F2-Start` (desktop) i `F2-Tel-Start` (telefon), z własnym układem: granatowa sekcja otwierająca, potem jasne sekcje, stopka.

**Contract**: sekcje i teksty:
- Nagłówek: „SubTracker” i link „Zaloguj się”.
- `h1` „Ile naprawdę płacisz za subskrypcje?”, akapit „Miej wszystkie swoje subskrypcje w jednym miejscu i wiedz, ile naprawdę na nie wydajesz.”, akapit „Roczne i miesięczne opłaty sprowadzamy do jednej kwoty. Ostrzegamy, gdy płacisz za podobne usługi albo zbliżasz się do limitu, i przypominamy o końcu okresu próbnego, zanim zacznie się płatność.”, przycisk „Załóż konto” (`/register`).
- Podgląd aplikacji w `figure` z podpisem „Podgląd aplikacji na przykładowych danych.”: cztery pozycje jak na makiecie (Netflix 43,00 zł / mies., Spotify 23,99 zł / mies., Microsoft 365 429,99 zł / rok, Duolingo 29,99 zł / mies. w trialu), suma miesięczna 102,82 zł i roczna 1 233,87 zł. To statyczny HTML, nie dane z API.
- Sekcja „Arkusz trzeba pilnować. SubTracker pilnuje sam.” z akapitem z makiety.
- Trzy sekcje funkcji z fragmentem interfejsu obok: „Realny koszt w jednej liczbie” (podział na kategorie), „Ostrzeżenie, zanim przepłacisz” (pasek ostrzeżenia i limit 85%), „Koniec triala Cię nie zaskoczy” (pozycja Duolingo). Teksty z makiety.
- Zamknięcie „Zacznij od pierwszej subskrypcji” z przyciskiem „Załóż konto” i stopka z linkiem „Polityka prywatności”.
- Style komponentu poniżej 8 kB (błąd budżetu `anyComponentStyle`). Jeśli się nie mieszczą, nadmiar trafia do globalnego partiala `src/styles/_home.scss`, bez podnoszenia limitu w `angular.json`.
- Kwoty muszą się zgadzać z widocznymi pozycjami, bo produkt obiecuje poprawne sumy: trial nie wchodzi do sumy, więc miesięcznie 43,00 + 23,99 + 35,83 (429,99 / 12) = 102,82 zł, a rocznie (43,00 + 23,99) × 12 + 429,99 = 1 233,87 zł. Sekcja kategorii pokazuje te same pozycje: Streaming 43,00, Praca 35,83, Muzyka 23,99, razem 102,82 zł. Przykład w sekcji ostrzeżeń (3 subskrypcje streamingowe, limit 85%) jest osobną ilustracją i nie musi wynikać z podglądu.

#### 2. Renderowanie `/`

**File**: `frontend-subtracker/src/app/app.routes.server.ts`, `frontend-subtracker/src/app/auth/auth.guard.ts`

**Intent**: `/` ma gotowy HTML z builda; zalogowany trafia na `/subscriptions` po starcie aplikacji.

**Contract**:
- Wpis `''` w `serverRoutes` zmienia się na `RenderMode.Prerender`; komentarz nad wpisami opisuje, dlaczego `/` jest wyjątkiem od reguły „trasy z `guestGuard` w Client”.
- `guestGuard` na platformie serwerowej (`isPlatformServer(inject(PLATFORM_ID))`) zwraca `true` bez wołania API. W przeglądarce działa jak dziś.

#### 3. Wariant awaryjny: SSR (tylko jeśli pomiar nie przejdzie)

**File**: `frontend-subtracker/src/app/app.routes.server.ts`, `frontend-subtracker/src/app/auth/auth.guard.ts`, `frontend-subtracker/src/server.ts`

**Intent**: Gdy zalogowany widzi stronę startową dłużej niż przez próg, `/` renderuje się na żądanie, a serwer frontendu sam sprawdza sesję i przekierowuje.

**Contract**: `''` w `RenderMode.Server`; `guestGuard` na serwerze czyta ciasteczko `subtracker_session` z żądania (`REQUEST` z `@angular/core`) i woła `GET /auth/session` z tym ciasteczkiem w nagłówku `Cookie`, z limitem 3 s i przepuszczeniem przy błędzie. Odpowiedź `/auth/session` nie może trafić do HTML: wyłączyć dla niej transfer cache (`withHttpTransferCacheOptions` z `filter`), a odpowiedź serwera dla `/` dostaje `Cache-Control: private, no-store`. Uruchamiany tylko po nieudanym pomiarze na produkcji (5.6); decyzję i wynik pomiaru zapisać w `## Progress`.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Prerenderowany `dist/frontend-subtracker/browser/index.html` zawiera tekst „Ile naprawdę płacisz za subskrypcje?”
- Paczka deployu przechodzi: `npm run prepare-mydevil`

#### Manual Verification:

- Strona startowa zgadza się z makietą na desktopie i przy 390 px, bez poziomego przewijania
- Przy wyłączonym JavaScripcie treść `/` jest widoczna
- Niezalogowany na `/` zostaje na stronie startowej; „Załóż konto” i „Zaloguj się” prowadzą do właściwych stron
- Lokalnie przez `npm start` (API na localhost:3000): zalogowany wchodzący na `/` trafia na `/subscriptions`; czas mierzymy dopiero na produkcji (5.6)
- Konsola bez błędów hydratacji na `/`, także przy przekierowaniu zalogowanego

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 5: Wdrożenie

### Overview

Dokumentacja, PR i deploy frontendu, potem testy na produkcji. Zmiana dotyczy tylko `frontend-subtracker/` i `context/`, więc rusza tylko deploy frontendu.

### Changes Required:

#### 1. Dokumentacja

**File**: `CLAUDE.md` (sekcje „Tripwires” i „Architecture”, poza blokiem synchronizowanym), `context/foundation/tech-stack.md`

**Intent**: Zapisać, gdzie jest motyw, że Material instalujemy bez `ng add` i ikon z Google, że czcionka jest lokalna oraz że `/` jest prerenderowane mimo `guestGuard`.

**Contract**: tripwire o prerenderze uzupełniony o wyjątek `/` (albo `Server`, jeśli wszedł wariant awaryjny); linia o motywie w opisie frontendu.

#### 2. Pull request i deploy

**File**: —

**Intent**: Użytkownik pushuje branch `change/ui-foundation`, otwiera PR i scala go po zielonym CI. Deploy frontendu startuje po merge'u.

**Contract**: bez zmian w skryptach `deploy/mydevil/` i w `shared/.env`.

### Success Criteria:

#### Automated Verification:

- CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts`
- Deploy frontendu na `main` przeszedł, wraz z health-checkiem

#### Manual Verification:

- Na produkcji wszystkie strony mają nowy wygląd, a czcionka ładuje się z domeny aplikacji (Network, brak żądań do Google)
- Pełny przepływ na produkcji: strona startowa → rejestracja → link z maila → pusta lista → wylogowanie
- Na prawdziwym telefonie: strona startowa, rejestracja, logowanie i lista są czytelne, menu działa, nie ma poziomego przewijania
- Pomiar na produkcji: zalogowany widzi stronę startową krócej niż 1 s (mediana z 5 przeładowań); jeśli nie, wariant SSR z fazy 4 i ponowny deploy przed archiwizacją

---

## Testing Strategy

### Unit Tests:

- Brak: frontend nie ma celu `ng test`. Backend się nie zmienia, ale CI i tak uruchomi jego testy.

### Integration Tests:

- Brak automatycznych. Build z prerenderem i `prepare-mydevil` są bramką techniczną w każdej fazie.

### Manual Testing Steps:

1. Desktop (szerokość 1360 i 1024 px) i telefon (390 px w DevTools, potem prawdziwe urządzenie) dla każdej strony.
2. Pełny przepływ S-01 z prawdziwym API lokalnie, potem na produkcji.
3. Stany błędów: zły adres, brak zgód, wyłączone API, nieważny link.
4. Klawiatura i drzewo dostępności dla formularzy i menu.
5. Pomiar przekierowania zalogowanego z `/`: lokalnie tylko działanie, czas na produkcji.

## Performance Considerations

Material jest importowany per komponent i trafia do leniwie ładowanych stron, więc paczka `initial` powinna urosnąć niewiele; budżet 500 kB / 1 MB sprawdza build. Czcionka: cztery wagi IBM Plex Sans, ładowane tylko dla użytych zakresów znaków (`unicode-range` w plikach fontsource).

## Migration Notes

Brak danych do migracji. Wycofanie to `rollback.sh frontend` na serwerze, bez wpływu na API i bazę.

## References

- Decyzje projektowe: `context/changes/ui-foundation/change.md`
- Makiety: https://claude.ai/artifact/1GnVVi4MbScvb9CFMBT53J (rząd F2)
- Reguły renderowania i trasy po angielsku: `CLAUDE.md`, `context/foundation/lessons.md`
- Poprzednie decyzje o renderowaniu tras: `context/archive/2026-11-03-magic-link-sign-in/plan.md` (## Follow-ups, F2 Fix B)
- Guardy: `frontend-subtracker/src/app/auth/auth.guard.ts:12-38`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Material, motyw i czcionka

#### Automated

- [x] 1.1 Build produkcyjny z prerenderem przechodzi bez błędów budżetu: `cd frontend-subtracker && npm run build`
- [x] 1.2 Paczka deployu buduje się i zawiera pliki `.woff2`: `npm run prepare-mydevil`
- [x] 1.3 Zbudowane pliki nie odwołują się do Google Fonts: brak trafień `fonts.googleapis.com` i `fonts.gstatic.com` w `dist/`

#### Manual

- [x] 1.4 `npm start`: strony S-01 działają jak dotąd, tekst jest w IBM Plex Sans (DevTools, Computed font), a w zakładce Network nie ma żądań do Google

### Phase 2: Szkielety stron

#### Automated

- [ ] 2.1 Build przechodzi bez błędów budżetu, także `anyComponentStyle` (8 kB): `npm run build`
- [ ] 2.2 Prerenderowane `/privacy-policy` i `/unavailable` zawierają granatową kolumnę w HTML (`dist/frontend-subtracker/browser/privacy-policy/index.html`)

#### Manual

- [ ] 2.3 Na desktopie strony publiczne i `/subscriptions` mają kolumnę po lewej, zgodnie z makietami F2
- [ ] 2.4 Przy szerokości poniżej 840 px i na telefonie (DevTools, 390 px) kolumna zamienia się w nagłówek, bez poziomego przewijania strony
- [ ] 2.5 Menu na telefonie otwiera się, a „Wyloguj” z menu i z kolumny wylogowuje; przy wyłączonym API pojawia się dotychczasowy komunikat błędu
- [ ] 2.6 Klawiatura: Tab przechodzi przez nawigację, menu i „Wyloguj” w logicznej kolejności, fokus jest widoczny

### Phase 3: Ekrany S-01 na Materialu

#### Automated

- [ ] 3.1 Build przechodzi: `npm run build`
- [ ] 3.2 Paczka deployu przechodzi: `npm run prepare-mydevil`
- [ ] 3.3 Brak odwołań do starych klas w `frontend-subtracker/src/app/` (wyszukiwanie `class="page"`, `field-error`, `message--`)

#### Manual

- [ ] 3.4 Pełny przepływ lokalnie z prawdziwym API: rejestracja → link → „Zaloguj” → pusta lista → „Wyloguj”
- [ ] 3.5 Błędy: zły adres (`a@b`), brak zgód, wyłączone API dają te same komunikaty co przed zmianą, w nowym stylu
- [ ] 3.6 Czytnik ekranu albo drzewo dostępności w DevTools: pola mają etykiety, błędy są powiązane z polami, komunikaty mają `role`
- [ ] 3.7 Konsola przeglądarki bez błędów hydratacji na `/privacy-policy` i `/unavailable`

### Phase 4: Strona startowa

#### Automated

- [ ] 4.1 Build przechodzi: `npm run build`
- [ ] 4.2 Prerenderowany `dist/frontend-subtracker/browser/index.html` zawiera tekst „Ile naprawdę płacisz za subskrypcje?”
- [ ] 4.3 Paczka deployu przechodzi: `npm run prepare-mydevil`

#### Manual

- [ ] 4.4 Strona startowa zgadza się z makietą na desktopie i przy 390 px, bez poziomego przewijania
- [ ] 4.5 Przy wyłączonym JavaScripcie treść `/` jest widoczna
- [ ] 4.6 Niezalogowany na `/` zostaje na stronie startowej; „Załóż konto” i „Zaloguj się” prowadzą do właściwych stron
- [ ] 4.7 Lokalnie przez `npm start` (API na localhost:3000): zalogowany wchodzący na `/` trafia na `/subscriptions`; czas mierzymy dopiero na produkcji (5.6)
- [ ] 4.8 Konsola bez błędów hydratacji na `/`, także przy przekierowaniu zalogowanego

### Phase 5: Wdrożenie

#### Automated

- [ ] 5.1 CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts`
- [ ] 5.2 Deploy frontendu na `main` przeszedł, wraz z health-checkiem

#### Manual

- [ ] 5.3 Na produkcji wszystkie strony mają nowy wygląd, a czcionka ładuje się z domeny aplikacji (Network, brak żądań do Google)
- [ ] 5.4 Pełny przepływ na produkcji: strona startowa → rejestracja → link z maila → pusta lista → wylogowanie
- [ ] 5.5 Na prawdziwym telefonie: strona startowa, rejestracja, logowanie i lista są czytelne, menu działa, nie ma poziomego przewijania
- [ ] 5.6 Pomiar na produkcji: zalogowany widzi stronę startową krócej niż 1 s (mediana z 5 przeładowań); jeśli nie, wariant SSR z fazy 4 i ponowny deploy przed archiwizacją
