import { registerLocaleData } from '@angular/common';
import localePl from '@angular/common/locales/pl';
import { EnvironmentProviders, LOCALE_ID, Provider } from '@angular/core';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';

// The test environment of every spec (angular.json, test.options.providersFile). Only what the app
// has globally and a component cannot provide itself: the Polish locale of app.config.ts, plus Material
// animations turned off, because jsdom never finishes them. HTTP and the router are dependencies of
// particular components, so each spec provides them (provideHttpClientTesting(), provideRouter([])).
registerLocaleData(localePl);

const providers: (Provider | EnvironmentProviders)[] = [
  { provide: LOCALE_ID, useValue: 'pl-PL' },
  { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
];

export default providers;
