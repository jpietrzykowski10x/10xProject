import { BreakpointObserver } from '@angular/cdk/layout';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { of } from 'rxjs';
import { PHONE_MEDIA_QUERY } from '../../../shared/breakpoints';
import type { Subscription } from '../../../subscriptions/subscription.types';
import { SubscriptionTable } from './subscription-table';

const NETFLIX: Subscription = {
  id: 'subscription-1',
  name: 'Netflix',
  category: { id: 'category-1', name: 'Rozrywka', isDefault: true },
  amount: '43.00',
  billingCycle: 'monthly',
  paymentMethod: 'blik',
  status: 'active',
  trialEndDate: null,
  nextBillingDate: '2027-01-05',
  createdAt: '2026-11-13T12:00:00.000Z',
};

const SPOTIFY: Subscription = { ...NETFLIX, id: 'subscription-2', name: 'Spotify' };

// jsdom has no matchMedia, so the CDK sees a desktop window. The phone is the media query of the
// app shell matching; only the browser's window size is replaced, not the table.
const PHONE_WINDOW: Pick<BreakpointObserver, 'isMatched' | 'observe'> = {
  isMatched: (query) => query === PHONE_MEDIA_QUERY,
  observe: (query) => of({ matches: query === PHONE_MEDIA_QUERY, breakpoints: {} }),
};

async function createTable(phone = false): Promise<ComponentFixture<SubscriptionTable>> {
  if (phone) {
    TestBed.configureTestingModule({
      providers: [{ provide: BreakpointObserver, useValue: PHONE_WINDOW }],
    });
  }
  const fixture = TestBed.createComponent(SubscriptionTable);
  fixture.componentRef.setInput('subscriptions', [NETFLIX, SPOTIFY]);
  await fixture.whenStable();
  return fixture;
}

// The button a user reaches by its accessible name: the visible text is the same in every row.
function buttonsNamed(fixture: ComponentFixture<SubscriptionTable>, name: string) {
  return TestbedHarnessEnvironment.loader(fixture).getAllHarnesses(
    MatButtonHarness.with({ selector: `[aria-label="${name}"]` }),
  );
}

describe('SubscriptionTable', () => {
  it('should create', async () => {
    const fixture = TestBed.createComponent(SubscriptionTable);
    fixture.componentRef.setInput('subscriptions', []);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('emits edit with the subscription of the row whose "Edytuj" was clicked', async () => {
    const fixture = await createTable();
    const edit = vi.fn();
    const remove = vi.fn();
    fixture.componentInstance.edit.subscribe(edit);
    fixture.componentInstance.remove.subscribe(remove);

    const buttons = await buttonsNamed(fixture, 'Edytuj Netflix');
    expect(buttons).toHaveLength(1);
    await buttons[0].click();

    expect(edit).toHaveBeenCalledExactlyOnceWith(NETFLIX);
    expect(remove).not.toHaveBeenCalled();
  });

  it('on the phone offers "Edytuj" only once the row is expanded', async () => {
    const fixture = await createTable(true);
    const edit = vi.fn();
    fixture.componentInstance.edit.subscribe(edit);

    expect(await buttonsNamed(fixture, 'Edytuj Netflix')).toHaveLength(0);

    const host = fixture.nativeElement as HTMLElement;
    host
      .querySelector<HTMLButtonElement>(
        `button[aria-controls="subscription-details-${NETFLIX.id}"]`,
      )
      ?.click();
    await fixture.whenStable();

    const buttons = await buttonsNamed(fixture, 'Edytuj Netflix');
    expect(buttons).toHaveLength(1);
    expect(await buttonsNamed(fixture, 'Edytuj Spotify')).toHaveLength(0);
    await buttons[0].click();

    expect(edit).toHaveBeenCalledExactlyOnceWith(NETFLIX);
  });
});
