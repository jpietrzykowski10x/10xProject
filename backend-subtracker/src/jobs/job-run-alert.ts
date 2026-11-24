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
  // Why a failed run failed: `<step>: <code>` (job_run.failure); null for a partial run.
  failure: string | null;
  // A partial run lost part of its work, which is not retried.
  lost?: boolean;
}

const FAILED_SENTENCE = 'Przebieg zadania nie powiódł się.';
const PARTIAL_RETRIED_SENTENCE =
  'Przebieg zadania zakończył się częściowo: część pracy się nie udała i zostanie ponowiona w kolejnym przebiegu.';
const PARTIAL_LOST_SENTENCE =
  'Przebieg zadania zakończył się częściowo: część pracy przepadła, szczegóły w err.log.';

function sentenceOf(input: JobRunAlertInput): string {
  if (input.outcome === 'failed') {
    return FAILED_SENTENCE;
  }
  return input.lost === true ? PARTIAL_LOST_SENTENCE : PARTIAL_RETRIED_SENTENCE;
}

// The operator mail about a failed or partial job run. Only the job, the day, the outcome, the
// numbers and the step and code of a failure: never the error text (it can quote query parameters)
// and never user data.
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
  ];
  if (input.outcome === 'failed') {
    lines.push(`przyczyna: ${input.failure ?? 'nieznana'}`);
  }
  lines.push(`liczniki: ${counters}`);
  const sentence = sentenceOf(input);
  return {
    subject: `SubTracker: zadanie ${input.job} — ${input.outcome}`,
    text: `${sentence}\n${lines.join('\n')}\nSzczegóły w logu API.`,
    html: `<p>${escapeHtml(sentence)}</p><p>${lines.map(escapeHtml).join('<br>')}<br>Szczegóły w logu API.</p>`,
  };
}
