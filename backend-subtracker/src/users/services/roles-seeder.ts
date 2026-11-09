import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  type EnvConfig,
  envFromConfig,
  isAutoSynchronization,
} from '../../config/env.js';
import { ROLE_DEFINITIONS } from '../../shared/types/role-code.js';
import { Role } from '../entities/role.entity.js';

// Synchronization builds the dev database from entities without running migrations, so the seed
// migration never reaches it. Every other database gets its roles from that migration.
@Injectable()
export class RolesSeeder implements OnApplicationBootstrap {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!isAutoSynchronization(envFromConfig(this.config))) {
      return;
    }
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(Role)
      .values(ROLE_DEFINITIONS)
      .orIgnore()
      .execute();
  }
}
