import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  type EnvConfig,
  envFromConfig,
  isAutoSynchronization,
} from '../../config/env.js';
import { DEFAULT_CATEGORIES } from '../default-categories.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX_SQL,
} from '../entities/category.entity.js';

// Synchronization builds the dev database from entities without running migrations, so neither
// the seed migration nor the hand-written unique index reaches it. Every other database gets both
// from migrations. Runs after synchronization, which happens while the connection is set up.
@Injectable()
export class CategoriesSeeder implements OnApplicationBootstrap {
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
      .into(Category)
      .values(DEFAULT_CATEGORIES.map(({ id, name }) => ({ id, name })))
      .orIgnore()
      .execute();
    await this.dataSource.query(CATEGORY_OWNER_NAME_INDEX_SQL);
  }
}
