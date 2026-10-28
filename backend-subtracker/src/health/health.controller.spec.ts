import { HttpStatus, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  const query = vi.fn<(sql: string) => Promise<unknown>>();
  const status = vi.fn();
  const res = { status } as unknown as Response;

  beforeEach(async () => {
    query.mockReset();
    status.mockReset();
    // The failure path logs the error on purpose; keep the test output clean.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DataSource, useValue: { query } }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok when the database answers', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.check(res)).resolves.toEqual({
      status: 'ok',
      db: 'ok',
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(status).not.toHaveBeenCalled();
  });

  it('reports 503 when the database query fails', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check(res)).resolves.toEqual({
      status: 'error',
      db: 'error',
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
