import { BillingCycle } from './subscription.types.js';
import {
  TRIAL_REMINDER_DAYS_BEFORE,
  type TrialReminderItem,
  trialReminderMail,
  trialReminderWindow,
} from './trial-reminder.js';

const TODAY = '2026-11-13';
const URL = 'https://subtracker.example.com/subscriptions';

function item(overrides: Partial<TrialReminderItem> = {}): TrialReminderItem {
  return {
    name: 'Netflix',
    trialEndDate: '2026-11-20',
    amount: '43.00',
    billingCycle: BillingCycle.MONTHLY,
    ...overrides,
  };
}

function mailFor(items: TrialReminderItem[]) {
  return trialReminderMail({ items, today: TODAY, subscriptionsUrl: URL });
}

describe('trialReminderWindow', () => {
  it('reminds a week ahead', () => {
    expect(TRIAL_REMINDER_DAYS_BEFORE).toBe(7);
  });

  // Oracle: the calendar.
  it.each([
    ['2026-11-13', '2026-11-20'],
    ['2026-11-28', '2026-12-05'],
    ['2026-12-28', '2027-01-04'],
    ['2028-02-25', '2028-03-03'],
  ])('on %s covers trials ending from that day to %s', (today, to) => {
    expect(trialReminderWindow(today)).toEqual({ from: today, to });
  });
});

describe('trialReminderMail', () => {
  describe('one trial', () => {
    // Oracle: today = 2026-11-13 and the calendar.
    it.each([
      ['2026-11-13', 'dziś'],
      ['2026-11-14', 'jutro'],
      ['2026-11-15', 'za 2 dni'],
      ['2026-11-20', 'za 7 dni'],
    ])('for a trial ending on %s says it ends %s', (trialEndDate, daysLeft) => {
      const mail = mailFor([item({ trialEndDate })]);

      expect(mail.subject).toBe(
        `Okres próbny „Netflix” kończy się ${daysLeft}`,
      );
      expect(mail.text).toContain(`(${daysLeft})`);
      expect(mail.html).toContain(`(${daysLeft})`);
    });

    it('lists the end date, the days left and the monthly price', () => {
      const mail = mailFor([item()]);

      expect(mail.text).toContain(
        '- Netflix: koniec 20.11.2026 (za 7 dni), potem 43,00 zł / mies.',
      );
      expect(mail.html).toContain(
        '<li><strong>Netflix</strong>: koniec 20.11.2026 (za 7 dni), potem 43,00 zł / mies.</li>',
      );
    });

    it('formats a yearly price with a decimal comma', () => {
      const mail = mailFor([
        item({ amount: '1234.50', billingCycle: BillingCycle.YEARLY }),
      ]);

      expect(mail.text).toContain('potem 1234,50 zł / rok');
      expect(mail.html).toContain('potem 1234,50 zł / rok');
    });

    it('links to the subscription list and says what to do, in both versions', () => {
      const mail = mailFor([item()]);

      expect(mail.text).toContain(URL);
      expect(mail.html).toContain(`<a href="${URL}">`);
      for (const part of [mail.text, mail.html]) {
        expect(part).toContain('zrezygnuj u dostawcy');
        expect(part).toContain('oznacz subskrypcję jako anulowaną');
      }
    });

    it('escapes the name in HTML only', () => {
      const name = '<script>alert(1)</script> & Co';
      const mail = mailFor([item({ name })]);

      expect(mail.html).toContain(
        '&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co',
      );
      expect(mail.html).not.toContain('<script>');
      expect(mail.text).toContain(`- ${name}: koniec`);
      expect(mail.subject).toBe(`Okres próbny „${name}” kończy się za 7 dni`);
    });
  });

  describe('several trials', () => {
    it('counts them in the subject and lists them by end date, then by Polish name order', () => {
      const mail = mailFor([
        item({ name: 'Zeta', trialEndDate: '2026-11-14' }),
        item({ name: 'Ćwiczenia', trialEndDate: '2026-11-16' }),
        item({ name: 'Disney+', trialEndDate: '2026-11-13' }),
        item({ name: 'Cyfra', trialEndDate: '2026-11-16' }),
        item({ name: 'Dazn', trialEndDate: '2026-11-16' }),
      ]);

      expect(mail.subject).toBe('Kończą się okresy próbne (5)');
      const listed = mail.text
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2, line.indexOf(':')));
      // Ć comes after C and before D in Polish, not after Z as in code point order.
      expect(listed).toEqual(['Disney+', 'Zeta', 'Cyfra', 'Ćwiczenia', 'Dazn']);
      expect(mail.html.match(/<li>/g)).toHaveLength(5);
    });
  });

  it('refuses an empty list', () => {
    expect(() => mailFor([])).toThrow();
  });
});
