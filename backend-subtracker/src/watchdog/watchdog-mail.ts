import { JOB_STALE_AFTER_HOURS } from '../jobs/job-health.js';
import { escapeHtml } from '../mail/escape-html.js';
import type { MailContent } from '../mail/mail.types.js';
import { APP_TIME_ZONE } from '../shared/date/calendar-day.js';
import {
  REMIND_EVERY_HOURS,
  type WatchdogAction,
  type WatchdogTarget,
} from './watchdog-policy.js';

export type WatchdogMailAction = Exclude<WatchdogAction, 'none'>;

export interface WatchdogMailInput {
  target: WatchdogTarget;
  action: WatchdogMailAction;
  // Consecutive failed checks: the current count when down, the count before the recovery.
  failures: number;
  firstFailureAt: string | undefined;
  now: Date;
  // The `jobs` target only: which jobs are stale, or that /health did not report them at all.
  jobs?: JobsProblem;
}

export type JobsProblem =
  { kind: 'stale'; jobs: string[] } | { kind: 'unreadable' };

const TARGET_NAMES: Record<Exclude<WatchdogTarget, 'jobs'>, string> = {
  api: 'API',
  frontend: 'Frontend',
};

function subjectOf(input: WatchdogMailInput): string {
  if (input.target === 'jobs') {
    if (input.action === 'recovered') {
      return 'SubTracker: zadania cykliczne działają ponownie';
    }
    const problem =
      input.jobs?.kind === 'unreadable'
        ? 'stan zadań cyklicznych nieczytelny'
        : `zadanie cykliczne nie ruszyło od ${JOB_STALE_AFTER_HOURS} h`;
    return `SubTracker: ${input.action === 'remind-down' ? 'nadal ' : ''}${problem}`;
  }
  const name = TARGET_NAMES[input.target];
  switch (input.action) {
    case 'alert-down':
      return `SubTracker: ${name} nie odpowiada`;
    case 'remind-down':
      return `SubTracker: ${name} nadal nie odpowiada`;
    case 'recovered':
      return `SubTracker: ${name} działa ponownie`;
  }
}

function sentenceOf(action: WatchdogMailAction): string {
  switch (action) {
    case 'alert-down':
      return 'Watchdog wykrył awarię.';
    case 'remind-down':
      return `Awaria trwa. Kolejne przypomnienie za ${REMIND_EVERY_HOURS} h, jeśli nic się nie zmieni.`;
    case 'recovered':
      return 'Cel znów działa poprawnie.';
  }
}

function timeOf(iso: string | undefined): string {
  const at = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isNaN(at)
    ? 'nieznany'
    : `${new Date(at).toLocaleString('pl-PL', { timeZone: APP_TIME_ZONE })} (${APP_TIME_ZONE})`;
}

function jobsLine(problem: JobsProblem): string {
  return problem.kind === 'unreadable'
    ? 'stan zadań: /health nie zwrócił poprawnego pola jobs'
    : `zadania bez przebiegu od ${JOB_STALE_AFTER_HOURS} h: ${problem.jobs.join(', ')}`;
}

// The operator mail of the watchdog: the target, the failure count and when the failure started.
// No user data; the watchdog never reads any.
export function watchdogMail(input: WatchdogMailInput): MailContent {
  const lines = [
    `cel: ${input.target}`,
    `kolejne nieudane sprawdzenia: ${input.failures}`,
    `pierwsza porażka: ${timeOf(input.firstFailureAt)}`,
    `teraz: ${timeOf(input.now.toISOString())}`,
  ];
  if (input.jobs !== undefined && input.action !== 'recovered') {
    lines.push(jobsLine(input.jobs));
  }
  const sentence = sentenceOf(input.action);
  const footer = 'Szczegóły w logu watchdoga i w logach aplikacji na serwerze.';
  return {
    subject: subjectOf(input),
    text: `${sentence}\n${lines.join('\n')}\n${footer}`,
    html: `<p>${escapeHtml(sentence)}</p><p>${lines.map(escapeHtml).join('<br>')}</p><p>${escapeHtml(footer)}</p>`,
  };
}
