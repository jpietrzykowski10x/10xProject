import { MoreThanOrEqual } from 'typeorm';
import { JobRun } from '../../src/jobs/entities/job-run.entity.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import { MailStatus, MailType } from '../../src/mail/mail.types.js';
import { MailService } from '../../src/mail/services/mail.service.js';
import {
  addDays,
  APP_TIME_ZONE,
  calendarDayIn,
} from '../../src/shared/date/calendar-day.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import {
  type TrialReminderRunResult,
  TrialReminderService,
} from '../../src/subscriptions/services/trial-reminder.service.js';
import type { SubscriptionResponse } from '../../src/subscriptions/subscription.types.js';
import { TrialReminderScheduler } from '../../src/subscriptions/trial-reminder.scheduler.js';
import { User } from '../../src/users/entities/user.entity.js';
import { createE2eApp, type SignedIn } from '../support/e2e-app.js';
import { subscriptionBody, subscriptionRequests } from './subscriptions-e2e.js';

describe('Subscriptions — trial reminder job (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job). The job sees every account, so "today" is the real day in Warsaw and the
  // dates are relative to it, and the assertions look only at the rows and mail of this file's
  // accounts.
  const e2e = createE2eApp({
    addressPrefix: 'e2e-subscriptions-trial-reminder-',
  });
  const { repository, signIn, sent, failMailTo, isFileAddress } = e2e;
  const { postSubscription, putSubscription, cancelSubscription } =
    subscriptionRequests(e2e);

  const today = calendarDayIn(APP_TIME_ZONE, new Date());

  let owner: SignedIn;
  let blocked: SignedIn;
  let dueInSeven: SubscriptionResponse;
  let dueInThree: SubscriptionResponse;
  let dueToday: SubscriptionResponse;
  let beyondWindow: SubscriptionResponse;
  let endedYesterday: SubscriptionResponse;
  let cancelledTrial: SubscriptionResponse;
  let active: SubscriptionResponse;
  let blockedTrial: SubscriptionResponse;
  let firstRun: TrialReminderRunResult;
  let firstRunMails: number;

  const createTrial = async (
    cookie: string,
    name: string,
    trialEndDate: string,
  ): Promise<SubscriptionResponse> =>
    (
      await postSubscription(
        cookie,
        subscriptionBody({
          name,
          status: 'trial',
          trialEndDate,
          nextBillingDate: trialEndDate,
        }),
      ).expect(201)
    ).body as SubscriptionResponse;

  const stored = (subscription: SubscriptionResponse) =>
    repository(Subscription).findOneByOrFail({ id: subscription.id });

  const sendDue = () => e2e.app.get(TrialReminderService).sendDue(today);

  // Mail to the address sent from the given position of `sent` on.
  const mailTo = (address: string, from: number) =>
    sent.slice(from).filter((message) => message.to === address);

  beforeAll(async () => {
    // start() also waits for the background startup run of the reminders.
    await e2e.start();

    owner = await signIn();
    dueInSeven = await createTrial(
      owner.cookie,
      'Due seven',
      addDays(today, 7),
    );
    dueInThree = await createTrial(
      owner.cookie,
      'Due three',
      addDays(today, 3),
    );
    dueToday = await createTrial(owner.cookie, 'Due today', today);
    beyondWindow = await createTrial(
      owner.cookie,
      'Beyond window',
      addDays(today, 8),
    );
    endedYesterday = await createTrial(
      owner.cookie,
      'Ended yesterday',
      addDays(today, -1),
    );
    cancelledTrial = await createTrial(
      owner.cookie,
      'Cancelled trial',
      addDays(today, 2),
    );
    await cancelSubscription(owner.cookie, cancelledTrial.id).expect(200);
    active = (
      await postSubscription(
        owner.cookie,
        subscriptionBody({
          name: 'Active plan',
          nextBillingDate: addDays(today, 2),
        }),
      ).expect(201)
    ).body as SubscriptionResponse;

    blocked = await signIn();
    blockedTrial = await createTrial(
      blocked.cookie,
      'Blocked trial',
      addDays(today, 2),
    );
    await repository(User).update(
      { id: await e2e.userIdOf(blocked.address) },
      { isActive: false },
    );

    firstRunMails = sent.length;
    firstRun = await sendDue();
  });

  afterAll(() => e2e.close());

  it('counts at least the reminders of this file (other accounts may add to them)', () => {
    expect(firstRun.usersNotified).toBeGreaterThanOrEqual(1);
    expect(firstRun.remindersSent).toBeGreaterThanOrEqual(3);
  });

  it('sends one mail listing the trials that end from today to today + 7 and no other', () => {
    const mails = mailTo(owner.address, firstRunMails);

    expect(mails).toHaveLength(1);
    for (const name of ['Due seven', 'Due three', 'Due today']) {
      expect(mails[0].text).toContain(name);
    }
    for (const name of [
      'Beyond window',
      'Ended yesterday',
      'Cancelled trial',
      'Active plan',
    ]) {
      expect(mails[0].text).not.toContain(name);
    }
  });

  it('marks the reminded trials with their end date and leaves the rest unmarked', async () => {
    for (const subscription of [dueInSeven, dueInThree, dueToday]) {
      const row = await stored(subscription);
      expect(row.trialReminderSentFor).toBe(row.trialEndDate);
    }
    for (const subscription of [
      beyondWindow,
      endedYesterday,
      cancelledTrial,
      active,
    ]) {
      expect((await stored(subscription)).trialReminderSentFor).toBeNull();
    }
  });

  it('skips a blocked account', async () => {
    expect(mailTo(blocked.address, firstRunMails)).toEqual([]);
    expect((await stored(blockedTrial)).trialReminderSentFor).toBeNull();
  });

  // The counts of the second run cover the whole database, so the check is on this file's rows
  // and mail: a second run on the same day sends nothing more and changes none of the rows.
  it('sends nothing and changes none of these rows in a second run on the same day', async () => {
    const subscriptions = [
      dueInSeven,
      dueInThree,
      dueToday,
      beyondWindow,
      endedYesterday,
      cancelledTrial,
      active,
      blockedTrial,
    ];
    const beforeSecond = await Promise.all(subscriptions.map(stored));
    const from = sent.length;

    await sendDue();

    expect(
      sent.slice(from).filter((message) => isFileAddress(message.to)),
    ).toEqual([]);
    expect(await Promise.all(subscriptions.map(stored))).toEqual(beforeSecond);
  });

  it('reminds again about a trial whose end date was moved', async () => {
    const moved = addDays(today, 5);
    await putSubscription(
      owner.cookie,
      dueInSeven.id,
      subscriptionBody({
        name: 'Due seven',
        status: 'trial',
        trialEndDate: moved,
        nextBillingDate: moved,
      }),
    ).expect(200);
    const from = sent.length;

    const run = await sendDue();

    expect(run.remindersSent).toBeGreaterThanOrEqual(1);
    const mails = mailTo(owner.address, from);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain('Due seven');
    expect(mails[0].text).not.toContain('Due three');
    expect(mails[0].text).not.toContain('Due today');
    expect((await stored(dueInSeven)).trialReminderSentFor).toBe(moved);
  });

  it('releases the reminder when the mail fails and sends it on the next run', async () => {
    const failing = await signIn();
    const trial = await createTrial(
      failing.cookie,
      'Failing mail',
      addDays(today, 4),
    );
    failMailTo(failing.address, true);

    const failedRun = await sendDue();

    expect(failedRun.usersFailed).toBeGreaterThanOrEqual(1);
    expect((await stored(trial)).trialReminderSentFor).toBeNull();
    expect(
      await repository(Mail).findBy({
        recipient: failing.address,
        type: MailType.TRIAL_REMINDER,
      }),
    ).toEqual([expect.objectContaining({ status: MailStatus.FAILED })]);

    failMailTo(failing.address, false);
    const from = sent.length;

    await sendDue();

    const mails = mailTo(failing.address, from);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain('Failing mail');
    expect((await stored(trial)).trialReminderSentFor).toBe(addDays(today, 4));
  });

  // A block before the claim leaves the account out of the run (OWNER_IS_ACTIVE); this one comes
  // between the claim and the send, so the mail service finds a blocked account.
  it('counts an account blocked between the claim and the send as skipped, and the run as a success', async () => {
    const late = await signIn();
    const trial = await createTrial(
      late.cookie,
      'Blocked in between',
      addDays(today, 5),
    );
    const lateId = await e2e.userIdOf(late.address);
    // The real method, bound before the spy replaces it on the prototype.
    const mail = e2e.app.get(MailService);
    const sendToUser = mail.sendToUser.bind(mail);
    const spy = vi
      .spyOn(MailService.prototype, 'sendToUser')
      .mockImplementation(async (type, to, content) => {
        if (to === late.address) {
          await repository(User).update({ id: lateId }, { isActive: false });
        }
        return sendToUser(type, to, content);
      });
    const since = new Date();
    const from = sent.length;

    try {
      await e2e.app.get(TrialReminderScheduler).daily();
    } finally {
      spy.mockRestore();
    }

    const runs = await repository(JobRun).find({
      where: { job: 'trial-reminder', startedAt: MoreThanOrEqual(since) },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe('success');
    expect(runs[0].counters?.usersSkipped).toBeGreaterThanOrEqual(1);
    expect(runs[0].counters?.usersFailed).toBe(0);
    expect(runs[0].counters?.remindersLost).toBe(0);
    expect(mailTo(late.address, from)).toEqual([]);
    // Released, so the account gets the reminder after an unblock.
    expect((await stored(trial)).trialReminderSentFor).toBeNull();
  });
});
