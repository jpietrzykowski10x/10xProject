import { JOB_NAMES } from '../../src/jobs/job-run.types.js';
import { createE2eApp } from '../support/e2e-app.js';

// Shifts every job_run row by this many hours: -27 ages them past the stale threshold of 26 h,
// +27 puts them back.
async function shiftRuns(
  query: (sql: string, parameters: unknown[]) => Promise<unknown>,
  hours: number,
): Promise<void> {
  await query(
    `UPDATE job_run
        SET started_at = started_at + make_interval(hours => $1),
            finished_at = finished_at + make_interval(hours => $1)`,
    [hours],
  );
}

describe('Health — job state (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job). The file creates no accounts; job_run rows of other files and runs stay
  // where they are, apart from the reversible shift in the stale test.
  const e2e = createE2eApp({ addressPrefix: 'e2e-health-jobs-' });
  const { http } = e2e;

  beforeAll(async () => {
    // start() awaits the startup runs of the lifecycle job and the cleanup, and waits for the
    // background startup run of the trial reminders: each job has a fresh finished run.
    await e2e.start();
  });

  afterAll(async () => {
    await e2e.close();
  });

  it('reports every job as ok after the startup runs, without a cookie', async () => {
    const response = await http().get('/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      db: 'ok',
      // The e2e app runs in backend-subtracker/, which has no .deploy-info.
      version: 'dev',
      jobs: Object.fromEntries(JOB_NAMES.map((job) => [job, 'ok'])),
    });
  });

  // Every row is shifted, not only this file's: the latest finished run of a job may be a row of
  // an earlier file or run, and it must age too. Shifting back afterwards leaves the register as
  // it was; e2e files run one after another, so no run starts in between.
  it('reports every job as stale when its latest finished run ended 27 h ago', async () => {
    const query = (sql: string, parameters: unknown[]) =>
      e2e.dataSource.query(sql, parameters);
    await shiftRuns(query, -27);
    try {
      const response = await http().get('/health').expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        db: 'ok',
        version: 'dev',
        jobs: Object.fromEntries(JOB_NAMES.map((job) => [job, 'stale'])),
      });
    } finally {
      await shiftRuns(query, 27);
    }
  });
});
