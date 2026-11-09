// Grants the ADMIN role: `npm run admin:grant -- <mail>`. Like the TypeORM CLI this does not boot
// Nest, so .env is loaded when present (locally); on the server the variables are exported.
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.js';
import { buildDatabaseOptions } from '../database/database.options.js';
import { Role } from '../users/entities/role.entity.js';
import { UserRole } from '../users/entities/user-role.entity.js';
import { User } from '../users/entities/user.entity.js';
import { grantAdmin } from '../users/grant-admin.js';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (email === undefined) {
    throw new Error('Usage: npm run admin:grant -- <mail>');
  }

  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const dataSource = new DataSource({
    ...buildDatabaseOptions(validateEnv(process.env), 'app'),
    // This script must never change the schema, whatever the environment says.
    synchronize: false,
    entities: [User, Role, UserRole],
  });
  await dataSource.initialize();
  try {
    await grantAdmin(dataSource, email);
    console.log(`Role ADMIN granted to ${email}`);
  } finally {
    await dataSource.destroy();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
