import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  type EnvConfig,
  envFromConfig,
  isAutoSynchronization,
} from '../../config/env.js';
import { toNameKey } from '../../shared/text/name-key.js';
import { DEFAULT_CATEGORIES } from '../default-categories.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX_SQL,
} from '../entities/category.entity.js';

const LEGACY_CATEGORY_OWNER_NAME_INDEX = 'UQ_category_owner_name';

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
      .values(
        DEFAULT_CATEGORIES.map(({ id, name }) => ({
          id,
          name,
          nameKey: toNameKey(name),
        })),
      )
      .orIgnore()
      .execute();
    // The index on lower(name) that UQ_category_owner_name_key replaced; a dev database created
    // before the CategoryNameKey migration still has it. This only helps once name_key exists:
    // synchronize cannot add a NOT NULL column to a table with rows, so such a database first
    // needs dev-local/backfill-category-name-key.mjs (see backend-patterns.md, „Dane domenowe”).
    await this.dataSource.query(
      `DROP INDEX IF EXISTS "${LEGACY_CATEGORY_OWNER_NAME_INDEX}"`,
    );
    await this.dataSource.query(CATEGORY_OWNER_NAME_INDEX_SQL);
  }
}
