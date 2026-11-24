import { HttpStatus, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { DataSource, QueryFailedError } from 'typeorm';
import { JobRunService } from '../jobs/job-run.service.js';
import type { JobName, LatestJobRun } from '../jobs/job-run.types.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  const query = vi.fn<(sql: string) => Promise<unknown>>();
  const latestFinished = vi.fn<() => Promise<Map<JobName, LatestJobRun>>>();
  const status = vi.fn();
  const res = { status } as unknown as Response;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    query.mockReset();
    latestFinished.mockReset();
    status.mockReset();
    // The failure paths log the error on purpose; keep the test output clean.
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: { query } },
        { provide: JobRunService, useValue: { latestFinished } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok and the state of each job when the database answers', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    const finishedAt = new Date();
    latestFinished.mockResolvedValue(
      new Map<JobName, LatestJobRun>([
        ['subscription-lifecycle', { finishedAt, outcome: 'success' }],
        ['auth-cleanup', { finishedAt, outcome: 'failed' }],
      ]),
    );

    await expect(controller.check(res)).resolves.toEqual({
      status: 'ok',
      db: 'ok',
      jobs: {
        'subscription-lifecycle': 'ok',
        'auth-cleanup': 'failed',
        'trial-reminder': 'stale',
      },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(status).not.toHaveBeenCalled();
  });

  it('reports 503 without the jobs when the database query fails', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check(res)).resolves.toEqual({
      status: 'error',
      db: 'error',
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(latestFinished).not.toHaveBeenCalled();
  });

  it('stays 200 without the jobs when the job runs cannot be read', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    latestFinished.mockRejectedValue(
      new Error('relation "job_run" does not exist'),
    );

    await expect(controller.check(res)).resolves.toEqual({
      status: 'ok',
      db: 'ok',
    });
    expect(status).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      'Reading the job runs for the health check failed (code: Error)',
    );
  });

  it('logs only the code and a stack without the message of a failed query', async () => {
    const failure = new QueryFailedError(
      'SELECT 1',
      [],
      Object.assign(new Error('role "jan@example.com" does not exist'), {
        code: '28000',
      }),
    );
    query.mockRejectedValue(failure);

    await controller.check(res);

    expect(logError).toHaveBeenCalledOnce();
    const [line, stack] = logError.mock.calls[0] as [string, string];
    expect(line).toBe('Database health check failed (code: 28000)');
    expect(stack).toMatch(/^QueryFailedError: <message omitted>\n\s+at /);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      'jan@example.com',
    );
  });
});
