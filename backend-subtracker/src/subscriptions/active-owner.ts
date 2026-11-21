// The jobs leave the subscriptions of a blocked account alone: no lifecycle transitions and no
// reminders. Their conditions stay true, so the first run after the account is unblocked catches
// up. Qualified by the table name, so it works in an aliased SELECT and in an UPDATE alike; the
// lookup goes by the primary key of "user".
export const OWNER_IS_ACTIVE =
  'EXISTS (SELECT 1 FROM "user" "owner" WHERE "owner"."id" = "subscription"."user_id" AND "owner"."is_active" = true)';
