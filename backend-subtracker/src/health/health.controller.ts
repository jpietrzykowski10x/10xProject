import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../shared/decorators/public.decorator.js';

export interface HealthStatus {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
}

// Used by the deploy health-check. Must stay @Public(): the deploy calls it without a cookie and
// rolls back when it fails.
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch (error) {
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? error.stack : String(error),
      );
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', db: 'error' };
    }
  }
}
