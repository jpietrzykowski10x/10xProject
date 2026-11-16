import { BreakpointObserver } from '@angular/cdk/layout';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { of } from 'rxjs';
import { PHONE_MEDIA_QUERY } from '../../../shared/breakpoints';
import type { Subscription, SubscriptionStatus } from '../../../subscriptions/subscription.types';
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

async function createTable(
  phone = false,
  subscriptions: Subscription[] = [NETFLIX, SPOTIFY],
): Promise<ComponentFixture<SubscriptionTable>> {
  if (phone) {
    TestBed.configureTestingModule({
      providers: [{ provide: BreakpointObserver, useValue: PHONE_WINDOW }],
    });
  }
  const fixture = TestBed.createComponent(SubscriptionTable);
  fixture.componentRef.setInput('subscriptions', subscriptions);
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

  // The oracle is the API's transitions (backend subscription-lifecycle.ts): active and trial can
  // be cancelled, only cancelled_pending resumed, and a cancelled subscription has neither action.
  it.each<[SubscriptionStatus, number, number]>([
    ['active', 1, 0],
    ['trial', 1, 0],
    ['cancelled_pending', 0, 1],
    ['cancelled', 0, 0],
  ])(
    'offers a %s row %i "Anuluj subskrypcję" and %i "Przywróć"',
    async (status, cancels, resumes) => {
      const subscription: Subscription = {
        ...NETFLIX,
        status,
        trialEndDate: status === 'trial' ? '2027-01-01' : null,
      };
      const fixture = await createTable(false, [subscription]);

      expect(await buttonsNamed(fixture, 'Anuluj subskrypcję Netflix')).toHaveLength(cancels);
      expect(await buttonsNamed(fixture, 'Przywróć Netflix')).toHaveLength(resumes);
      // Edit and delete stay for every status.
      expect(await buttonsNamed(fixture, 'Edytuj Netflix')).toHaveLength(1);
      expect(await buttonsNamed(fixture, 'Usuń Netflix')).toHaveLength(1);
    },
  );

  it('emits cancel and resume with the subscription of the row', async () => {
    const pending: Subscription = { ...SPOTIFY, status: 'cancelled_pending' };
    const fixture = await createTable(false, [NETFLIX, pending]);
    const cancel = vi.fn();
    const resume = vi.fn();
    fixture.componentInstance.cancel.subscribe(cancel);
    fixture.componentInstance.resume.subscribe(resume);

    await (await buttonsNamed(fixture, 'Anuluj subskrypcję Netflix'))[0].click();
    await (await buttonsNamed(fixture, 'Przywróć Spotify'))[0].click();

    expect(cancel).toHaveBeenCalledExactlyOnceWith(NETFLIX);
    expect(resume).toHaveBeenCalledExactlyOnceWith(pending);
  });

  // The button keeps the focus while disabled (disabledInteractive). The page sends one resume at a
  // time, so every "Przywróć" is disabled while one is in flight; other actions stay.
  it('disables every "Przywróć" while a resume is in flight', async () => {
    const pending: Subscription = { ...NETFLIX, status: 'cancelled_pending' };
    const other: Subscription = { ...SPOTIFY, status: 'cancelled_pending' };
    const fixture = await createTable(false, [pending, other]);

    fixture.componentRef.setInput('resumingId', pending.id);
    await fixture.whenStable();

    expect(await (await buttonsNamed(fixture, 'Przywróć Netflix'))[0].isDisabled()).toBe(true);
    expect(await (await buttonsNamed(fixture, 'Przywróć Spotify'))[0].isDisabled()).toBe(true);
    expect(await (await buttonsNamed(fixture, 'Usuń Spotify'))[0].isDisabled()).toBe(false);

    fixture.componentRef.setInput('resumingId', null);
    await fixture.whenStable();
    expect(await (await buttonsNamed(fixture, 'Przywróć Spotify'))[0].isDisabled()).toBe(false);
  });

  // A save of the edit form (a full PUT) after a cancel, resume or delete would undo it or fail,
  // so these actions of the row being saved wait for the answer; "Edytuj" and other rows stay.
  it('disables cancel, resume and delete of the row whose edit is being saved', async () => {
    const pending: Subscription = { ...SPOTIFY, status: 'cancelled_pending' };
    const fixture = await createTable(false, [NETFLIX, pending]);

    fixture.componentRef.setInput('savingId', NETFLIX.id);
    await fixture.whenStable();

    const disabled = async (name: string) => (await buttonsNamed(fixture, name))[0].isDisabled();
    expect(await disabled('Anuluj subskrypcję Netflix')).toBe(true);
    expect(await disabled('Usuń Netflix')).toBe(true);
    expect(await disabled('Edytuj Netflix')).toBe(false);
    expect(await disabled('Przywróć Spotify')).toBe(false);
    expect(await disabled('Usuń Spotify')).toBe(false);

    fixture.componentRef.setInput('savingId', pending.id);
    await fixture.whenStable();
    expect(await disabled('Przywróć Spotify')).toBe(true);
    expect(await disabled('Anuluj subskrypcję Netflix')).toBe(false);
  });

  it('on the phone offers the lifecycle action in the expanded row', async () => {
    const pending: Subscription = { ...SPOTIFY, status: 'cancelled_pending' };
    const fixture = await createTable(true, [NETFLIX, pending]);
    const host = fixture.nativeElement as HTMLElement;
    const expand = async (subscription: Subscription) => {
      host
        .querySelector<HTMLButtonElement>(
          `button[aria-controls="subscription-details-${subscription.id}"]`,
        )
        ?.click();
      await fixture.whenStable();
    };

    expect(await buttonsNamed(fixture, 'Anuluj subskrypcję Netflix')).toHaveLength(0);
    await expand(NETFLIX);
    expect(await buttonsNamed(fixture, 'Anuluj subskrypcję Netflix')).toHaveLength(1);
    expect(await buttonsNamed(fixture, 'Przywróć Netflix')).toHaveLength(0);

    await expand(pending);
    expect(await buttonsNamed(fixture, 'Przywróć Spotify')).toHaveLength(1);
    expect(await buttonsNamed(fixture, 'Anuluj subskrypcję Spotify')).toHaveLength(0);
  });
});
