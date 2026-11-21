// Grants the ADMIN role: `npm run admin:grant -- <mail>`
// (on the server `cli/admin-grant.js`, see deploy/mydevil/README.md).
import { RoleCode } from '../shared/types/role-code.js';
import { runRoleScript } from './role-script.js';

await runRoleScript('grant', RoleCode.ADMIN, 'admin:grant');
