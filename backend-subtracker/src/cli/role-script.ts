// The shared frame of the role scripts (admin:grant, admin:revoke, superadmin:grant,
// superadmin:revoke). Like the TypeORM CLI they do not boot Nest, so .env is loaded when present
// (locally); on the server the variables are exported. Any error ends with exit code 1; a grant or
// revocation that changes nothing is not an error.
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { AdminAudit } from '../admin/entities/admin-audit.entity.js';
import { validateEnv } from '../config/env.js';
import { buildDatabaseOptions } from '../database/database.options.js';
import { failureCodeOf } from '../shared/database/failure-code.js';
import type { RoleCode } from '../shared/types/role-code.js';
import { Role } from '../users/entities/role.entity.js';
import { UserRole } from '../users/entities/user-role.entity.js';
import { User } from '../users/entities/user.entity.js';
import {
  type GrantResult,
  grantRole,
  type RevokeResult,
  revokeRole,
} from '../users/role-grants.js';

export type RoleScriptAction = 'grant' | 'revoke';

const ACTIONS = {
  grant: grantRole,
  revoke: revokeRole,
} as const;

// What the console says, by what the script did.
const DONE: Record<GrantResult | RevokeResult, string> = {
  granted: 'granted to',
  already_granted: 'already granted to',
  revoked: 'revoked from',
  not_granted: 'was not granted to',
};

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
    // AdminAudit for the row every actual change leaves.
    entities: [User, Role, UserRole, AdminAudit],
  });
  await dataSource.initialize();
  try {
    const result = await ACTIONS[action](dataSource, email, code);
    console.log(`Role ${code} ${DONE[result]} ${email}`);
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
    // The database code (e.g. 23505, also of the cause behind a friendlier message) or the error
    // class, so a failure can be told apart.
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause !== undefined ? error.cause : error;
    console.error(`${message} (code: ${failureCodeOf(cause)})`);
    process.exitCode = 1;
  }
}
