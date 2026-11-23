import { watchdogMail } from './watchdog-mail.js';

const NOW = new Date('2026-11-22T10:00:00.000Z');
const FIRST = '2026-11-22T09:50:00.000Z';

describe('watchdogMail', () => {
  it.each([
    ['api', 'alert-down', 'SubTracker: API nie odpowiada'],
    ['api', 'remind-down', 'SubTracker: API nadal nie odpowiada'],
    ['api', 'recovered', 'SubTracker: API działa ponownie'],
    ['frontend', 'alert-down', 'SubTracker: Frontend nie odpowiada'],
    ['frontend', 'recovered', 'SubTracker: Frontend działa ponownie'],
    ['jobs', 'recovered', 'SubTracker: zadania cykliczne działają ponownie'],
  ] as const)('names %s %s in the subject', (target, action, subject) => {
    expect(
      watchdogMail({
        target,
        action,
        failures: 3,
        firstFailureAt: FIRST,
        now: NOW,
      }).subject,
    ).toBe(subject);
  });

  it('tells a stale job from an unreadable jobs field', () => {
    const stale = watchdogMail({
      target: 'jobs',
      action: 'alert-down',
      failures: 3,
      firstFailureAt: FIRST,
      now: NOW,
      jobs: { kind: 'stale', jobs: ['auth-cleanup'] },
    });
    const unreadable = watchdogMail({
      target: 'jobs',
      action: 'remind-down',
      failures: 150,
      firstFailureAt: FIRST,
      now: NOW,
      jobs: { kind: 'unreadable' },
    });

    expect(stale.subject).toBe(
      'SubTracker: zadanie cykliczne nie ruszyło od 26 h',
    );
    expect(stale.text).toContain('zadania bez przebiegu od 26 h: auth-cleanup');
    expect(unreadable.subject).toBe(
      'SubTracker: nadal stan zadań cyklicznych nieczytelny',
    );
    expect(unreadable.text).toContain('nie zwrócił poprawnego pola jobs');
  });

  it.each([
    ['alert-down', 'SubTracker: API bez bazy danych', true],
    ['remind-down', 'SubTracker: API nadal bez bazy danych', true],
    ['recovered', 'SubTracker: API działa ponownie', false],
  ] as const)(
    'names the database for an api %s when /health reported db error',
    (action, subject, causeLine) => {
      const mail = watchdogMail({
        target: 'api',
        action,
        failures: 3,
        firstFailureAt: FIRST,
        now: NOW,
        databaseDown: true,
      });

      expect(mail.subject).toBe(subject);
      expect(mail.text.includes('db: error')).toBe(causeLine);
    },
  );

  it('gives the target, the failure count and the start of the failure in Warsaw time', () => {
    const mail = watchdogMail({
      target: 'api',
      action: 'alert-down',
      failures: 3,
      firstFailureAt: FIRST,
      now: NOW,
    });

    expect(mail.text).toContain('cel: api');
    expect(mail.text).toContain('kolejne nieudane sprawdzenia: 3');
    // 09:50 UTC is 10:50 in Warsaw in November.
    expect(mail.text).toMatch(
      /pierwsza porażka: .*10:50:00 \(Europe\/Warsaw\)/,
    );
    expect(mail.html).toContain('cel: api<br>');
  });

  it('says "nieznany" when the start of the failure is not known', () => {
    const mail = watchdogMail({
      target: 'frontend',
      action: 'recovered',
      failures: 0,
      firstFailureAt: undefined,
      now: NOW,
    });

    expect(mail.text).toContain('pierwsza porażka: nieznany');
  });
});
