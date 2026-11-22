import { jobRunAlert } from './job-run-alert.js';

describe('jobRunAlert', () => {
  it('names the job and the outcome in the subject', () => {
    const mail = jobRunAlert({
      job: 'subscription-lifecycle',
      trigger: 'cron',
      outcome: 'failed',
      day: '2026-11-22',
      counters: null,
    });

    expect(mail.subject).toBe(
      'SubTracker: zadanie subscription-lifecycle — failed',
    );
    expect(mail.text).toContain('nie powiódł się');
    expect(mail.text).toContain('dzień: 2026-11-22');
    expect(mail.text).toContain('wyzwalacz: cron');
    expect(mail.text).toContain('wynik: failed');
    expect(mail.text).toContain('liczniki: brak');
    expect(mail.text).toContain('Szczegóły w logu API.');
  });

  it('lists the counters of a partial run in the text and the HTML', () => {
    const mail = jobRunAlert({
      job: 'trial-reminder',
      trigger: 'startup',
      outcome: 'partial',
      day: '2026-11-22',
      counters: { usersNotified: 3, remindersSent: 4, usersFailed: 1 },
    });

    const counters =
      'liczniki: usersNotified=3, remindersSent=4, usersFailed=1';
    expect(mail.subject).toBe('SubTracker: zadanie trial-reminder — partial');
    expect(mail.text).toContain('częściowo');
    expect(mail.text).toContain(counters);
    expect(mail.html).toContain(counters);
    expect(mail.html).toContain('dzień: 2026-11-22');
  });

  it('escapes every value interpolated into the HTML', () => {
    const mail = jobRunAlert({
      job: 'auth-cleanup',
      trigger: 'cron',
      outcome: 'partial',
      day: '<b>2026-11-22</b>',
      counters: { '<script>': 1 },
    });

    expect(mail.html).not.toContain('<b>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;b&gt;2026-11-22&lt;/b&gt;');
    expect(mail.html).toContain('&lt;script&gt;=1');
  });

  // The input has no field for the error or a user, so the mail can hold only these lines.
  it('holds only the job, the day, the trigger, the outcome and the counters', () => {
    const mail = jobRunAlert({
      job: 'auth-cleanup',
      trigger: 'cron',
      outcome: 'failed',
      day: '2026-11-22',
      counters: null,
    });

    expect(mail.text.split('\n')).toEqual([
      'Przebieg zadania nie powiódł się.',
      'zadanie: auth-cleanup',
      'dzień: 2026-11-22',
      'wyzwalacz: cron',
      'wynik: failed',
      'liczniki: brak',
      'Szczegóły w logu API.',
    ]);
    expect(mail.text).not.toContain('@');
  });
});
