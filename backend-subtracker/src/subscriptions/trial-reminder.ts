import { escapeHtml } from '../mail/escape-html.js';
import type { MailContent } from '../mail/mail.types.js';
import { addDays, daysBetween } from '../shared/date/calendar-day.js';
import { toGrosze } from '../shared/money/grosze.js';
import { BillingCycle } from './subscription.types.js';

// A trial is reminded about when its end is at most this many days ahead: from today up to and
// including today + 7. A trial that entered the window late (added inside it, or a missed run)
// is reminded about on the next run.
export const TRIAL_REMINDER_DAYS_BEFORE = 7;

// The window of trial end dates (inclusive, YYYY-MM-DD) that are due for a reminder today.
export function trialReminderWindow(today: string): {
  from: string;
  to: string;
} {
  return { from: today, to: addDays(today, TRIAL_REMINDER_DAYS_BEFORE) };
}

// One trial in the reminder mail; amount as the API's string ("43.00"), the price per cycle after
// the trial.
export interface TrialReminderItem {
  name: string;
  trialEndDate: string;
  amount: string;
  billingCycle: BillingCycle;
}

export interface TrialReminderMailInput {
  items: TrialReminderItem[];
  today: string;
  subscriptionsUrl: string;
}

const CYCLE_LABELS: Record<BillingCycle, string> = {
  [BillingCycle.MONTHLY]: 'mies.',
  [BillingCycle.YEARLY]: 'rok',
};

// "dziś", "jutro" or "za N dni"; the job only reminds about trials that have not ended yet.
function daysLeftLabel(today: string, trialEndDate: string): string {
  const days = daysBetween(today, trialEndDate);
  if (days < 0) {
    throw new Error(`Trial ended before today: ${trialEndDate}`);
  }
  if (days === 0) {
    return 'dziś';
  }
  if (days === 1) {
    return 'jutro';
  }
  return `za ${days} dni`;
}

// YYYY-MM-DD → DD.MM.YYYY
function polishDate(day: string): string {
  const [year, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}.${month}.${year}`;
}

// "43.00" → "43,00 zł / mies."; the string is only reformatted, never parsed into a float.
function amountPerCycle(amount: string, cycle: BillingCycle): string {
  toGrosze(amount); // refuses anything but the API's two-decimal format
  return `${amount.replace('.', ',')} zł / ${CYCLE_LABELS[cycle]}`;
}

// The one mail a run sends to a user, listing all of that user's trials due for a reminder.
export function trialReminderMail({
  items,
  today,
  subscriptionsUrl,
}: TrialReminderMailInput): MailContent {
  if (items.length === 0) {
    throw new Error('A trial reminder needs at least one trial');
  }
  const lines = [...items]
    .sort(
      (a, b) =>
        a.trialEndDate.localeCompare(b.trialEndDate) ||
        a.name.localeCompare(b.name, 'pl'),
    )
    .map((item) => ({
      name: item.name,
      daysLeft: daysLeftLabel(today, item.trialEndDate),
      endDate: polishDate(item.trialEndDate),
      price: amountPerCycle(item.amount, item.billingCycle),
    }));

  const subject =
    lines.length === 1
      ? `Okres próbny „${lines[0].name}” kończy się ${lines[0].daysLeft}`
      : `Kończą się okresy próbne (${lines.length})`;
  const intro =
    lines.length === 1
      ? 'Wkrótce kończy się okres próbny subskrypcji:'
      : 'Wkrótce kończą się okresy próbne subskrypcji:';
  const hint =
    'Jeśli nie chcesz płacić, zrezygnuj u dostawcy przed końcem okresu próbnego, a potem oznacz subskrypcję jako anulowaną w SubTrackerze.';
  const linkLabel = 'Otwórz listę subskrypcji w SubTrackerze';

  const textLines = lines.map(
    (line) =>
      `- ${line.name}: koniec ${line.endDate} (${line.daysLeft}), potem ${line.price}`,
  );
  const htmlLines = lines.map(
    (line) =>
      `<li><strong>${escapeHtml(line.name)}</strong>: koniec ${escapeHtml(line.endDate)} (${escapeHtml(line.daysLeft)}), potem ${escapeHtml(line.price)}</li>`,
  );

  return {
    subject,
    text: [
      intro,
      textLines.join('\n'),
      hint,
      `${linkLabel}:\n${subscriptionsUrl}`,
    ].join('\n\n'),
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<ul>${htmlLines.join('')}</ul>`,
      `<p>${escapeHtml(hint)}</p>`,
      `<p><a href="${escapeHtml(subscriptionsUrl)}">${escapeHtml(linkLabel)}</a></p>`,
    ].join(''),
  };
}
