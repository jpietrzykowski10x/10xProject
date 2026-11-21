// Revokes the ADMIN role: `npm run admin:revoke -- <mail>`
// (on the server `cli/admin-revoke.js`, see deploy/mydevil/README.md).
import { RoleCode } from '../shared/types/role-code.js';
import { runRoleScript } from './role-script.js';

await runRoleScript('revoke', RoleCode.ADMIN, 'admin:revoke');
