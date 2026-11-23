import { escapeHtml } from '../mail/escape-html.js';
import type { MailContent } from '../mail/mail.types.js';
import type { JobAlertOutcome, JobName, JobTrigger } from './job-run.types.js';

export interface JobRunAlertInput {
  job: JobName;
  trigger: JobTrigger;
  outcome: JobAlertOutcome;
  // The calendar day of the run in APP_TIME_ZONE (YYYY-MM-DD).
  day: string;
  counters: Record<string, number> | null;
}

const OUTCOME_SENTENCES: Record<JobAlertOutcome, string> = {
  failed: 'Przebieg zadania nie powiódł się.',
  partial:
    'Przebieg zadania zakończył się częściowo: część pracy się nie udała i zostanie ponowiona w kolejnym przebiegu.',
};

// The operator mail about a failed or partial job run. Only the job, the day, the outcome and the
// numbers: never the error text (it can quote query parameters) and never user data.
export function jobRunAlert(input: JobRunAlertInput): MailContent {
  const counters =
    input.counters === null || Object.keys(input.counters).length === 0
      ? 'brak'
      : Object.entries(input.counters)
          .map(([name, value]) => `${name}=${value}`)
          .join(', ');
  const lines = [
    `zadanie: ${input.job}`,
    `dzień: ${input.day}`,
    `wyzwalacz: ${input.trigger}`,
    `wynik: ${input.outcome}`,
    `liczniki: ${counters}`,
  ];
  const sentence = OUTCOME_SENTENCES[input.outcome];
  return {
    subject: `SubTracker: zadanie ${input.job} — ${input.outcome}`,
    text: `${sentence}\n${lines.join('\n')}\nSzczegóły w logu API.`,
    html: `<p>${escapeHtml(sentence)}</p><p>${lines.map(escapeHtml).join('<br>')}<br>Szczegóły w logu API.</p>`,
  };
}
