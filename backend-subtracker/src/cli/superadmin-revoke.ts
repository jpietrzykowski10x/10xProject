// Revokes the SUPER_ADMIN role: `npm run superadmin:revoke -- <mail>`
// (on the server `cli/superadmin-revoke.js`, see deploy/mydevil/README.md).
import { RoleCode } from '../shared/types/role-code.js';
import { runRoleScript } from './role-script.js';

await runRoleScript('revoke', RoleCode.SUPER_ADMIN, 'superadmin:revoke');
