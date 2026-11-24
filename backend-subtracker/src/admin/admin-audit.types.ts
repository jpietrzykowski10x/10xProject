import type { RoleCode } from '../shared/types/role-code.js';
import type { AdminStatusFilter } from './admin-user.types.js';

// What was done to or about an account; stored in admin_audit.action (varchar, no Postgres enum).
export enum AdminAction {
  // Opened the account's data.
  VIEW = 'VIEW',
  BLOCK = 'BLOCK',
  UNBLOCK = 'UNBLOCK',
  RESET_SESSIONS = 'RESET_SESSIONS',
  // Searched the accounts; no target.
  SEARCH = 'SEARCH',
  // An access action refused by the rank rule (admin_cannot_manage).
  DENIED = 'DENIED',
  // The owner deleted their own account (actor = target).
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  // A role script changed a role (no actor: the CLI).
  ROLE_GRANTED = 'ROLE_GRANTED',
  ROLE_REVOKED = 'ROLE_REVOKED',
}

// The actions an administrator takes on an account through AccountAccessService.
export type AccessAction =
  AdminAction.BLOCK | AdminAction.UNBLOCK | AdminAction.RESET_SESSIONS;

// admin_audit.details holds context that is not personal data: never an address, never the
// search fragment.
export interface SearchDetails {
  status: AdminStatusFilter;
  // The length of the fragment after folding, 0 without one.
  qLength: number;
  results: number;
}

export interface DeniedDetails {
  // The refused action in lower case (e.g. `block`) and the reason (`self` or `rank`), the same
  // words as the Denials log line.
  action: string;
  why: string;
}

export interface RoleDetails {
  role: RoleCode;
}

export type AdminAuditDetails = SearchDetails | DeniedDetails | RoleDetails;

// One row of admin_audit, by action. `actorId` null means the CLI, `targetId` null an action
// without a single target (a search).
export type AdminAuditEntry =
  | {
      action: AdminAction.VIEW | AccessAction | AdminAction.ACCOUNT_DELETED;
      actorId: string;
      targetId: string;
    }
  | {
      action: AdminAction.SEARCH;
      actorId: string;
      targetId: null;
      details: SearchDetails;
    }
  | {
      action: AdminAction.DENIED;
      actorId: string;
      targetId: string;
      details: DeniedDetails;
    }
  | {
      action: AdminAction.ROLE_GRANTED | AdminAction.ROLE_REVOKED;
      actorId: null;
      targetId: string;
      details: RoleDetails;
    };
