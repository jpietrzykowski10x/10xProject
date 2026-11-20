import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { Home } from './home';

const DELETED_NOTICE = 'Konto zostało usunięte razem ze wszystkimi danymi.';

@Component({ template: '' })
class Elsewhere {}

@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class Root {}

// The start page reached through the router, as in the app: the notice depends on the state of
// the navigation that creates the page.
async function navigateHome(state?: Record<string, unknown>): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', pathMatch: 'full', component: Home },
        { path: 'elsewhere', component: Elsewhere },
      ]),
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/elsewhere');
  const fixture = TestBed.createComponent(Root);
  // The outlet exists before the navigation, as in the app, so the page is created during it.
  await fixture.whenStable();
  await router.navigate(['/'], state === undefined ? {} : { state });
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const notices = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('[role="status"]')).map((element) =>
    element.textContent?.trim(),
  );

describe('Home', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // Only proves the component is created and its template rendered with the providers it has in
  // the app (a lost import or provider fails here).
  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
    expect(notices(fixture.nativeElement as HTMLElement)).toEqual([]);
  });

  // The oracle is the plan of S-10: the notice only after the account page's navigation.
  it('shows the deletion notice when the navigation carries { accountDeleted: true }', async () => {
    const host = await navigateHome({ accountDeleted: true });

    expect(notices(host)).toEqual([DELETED_NOTICE]);
  });

  it.each([[undefined], [{}], [{ accountDeleted: 'true' }]])(
    'shows no notice for the navigation state %j',
    async (state) => {
      const host = await navigateHome(state);

      expect(host.querySelector('.home__title')).not.toBeNull();
      expect(notices(host)).toEqual([]);
    },
  );
});
