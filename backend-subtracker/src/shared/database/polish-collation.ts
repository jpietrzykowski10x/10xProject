// ICU collation for sorting text in Polish order inside SQL (`ORDER BY ... COLLATE "pl-PL-x-icu"`).
// Needed because the production database sorts by code point: checked on MyDevil 2026-11-11, the
// database has datcollate/datctype C.UTF-8 (so "Ślub" sorted after "Zoo"), while the ICU
// collations pl-PL-x-icu and pl-x-icu are available there and in the local PostgreSQL.
export const POLISH_COLLATION = 'pl-PL-x-icu';
