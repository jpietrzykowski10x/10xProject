// Grants the SUPER_ADMIN role, refused while another account holds it:
// `npm run superadmin:grant -- <mail>` (on the server `cli/superadmin-grant.js`, see
// deploy/mydevil/README.md).
import { RoleCode } from '../shared/types/role-code.js';
import { runRoleScript } from './role-script.js';

await runRoleScript('grant', RoleCode.SUPER_ADMIN, 'superadmin:grant');
