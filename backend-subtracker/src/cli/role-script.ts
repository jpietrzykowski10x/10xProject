// The shared frame of the role scripts (admin:grant, admin:revoke, superadmin:grant,
// superadmin:revoke). Like the TypeORM CLI they do not boot Nest, so .env is loaded when present
// (locally); on the server the variables are exported. Any error ends with exit code 1.
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.js';
import { buildDatabaseOptions } from '../database/database.options.js';
import type { RoleCode } from '../shared/types/role-code.js';
import { Role } from '../users/entities/role.entity.js';
import { UserRole } from '../users/entities/user-role.entity.js';
import { User } from '../users/entities/user.entity.js';
import { grantRole, revokeRole } from '../users/role-grants.js';

export type RoleScriptAction = 'grant' | 'revoke';

const ACTIONS = {
  grant: { run: grantRole, done: 'granted to' },
  revoke: { run: revokeRole, done: 'revoked from' },
} as const;

async function main(
  action: RoleScriptAction,
  code: RoleCode,
  script: string,
): Promise<void> {
  const email = process.argv[2];
  if (email === undefined) {
    throw new Error(`Usage: npm run ${script} -- <mail>`);
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
    await ACTIONS[action].run(dataSource, email, code);
    console.log(`Role ${code} ${ACTIONS[action].done} ${email}`);
  } finally {
    await dataSource.destroy();
  }
}

// `script` is the npm script name, shown in the usage line.
export async function runRoleScript(
  action: RoleScriptAction,
  code: RoleCode,
  script: string,
): Promise<void> {
  try {
    await main(action, code, script);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
