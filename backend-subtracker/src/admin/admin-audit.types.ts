// What an administrator did to an account; stored in admin_audit.action (varchar, no Postgres enum).
export enum AdminAction {
  // Opened the account's data.
  VIEW = 'VIEW',
  BLOCK = 'BLOCK',
  UNBLOCK = 'UNBLOCK',
  RESET_SESSIONS = 'RESET_SESSIONS',
}
