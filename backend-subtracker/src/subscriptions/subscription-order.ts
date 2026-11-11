import { POLISH_COLLATION } from '../shared/database/polish-collation.js';
import { SubscriptionSort, SubscriptionStatus } from './subscription.types.js';

// Lower groups come first: running subscriptions, then those ending, then the ended ones.
export const STATUS_GROUPS: Record<SubscriptionStatus, number> = {
  [SubscriptionStatus.ACTIVE]: 0,
  [SubscriptionStatus.TRIAL]: 0,
  [SubscriptionStatus.CANCELLED_PENDING]: 1,
  [SubscriptionStatus.CANCELLED]: 2,
};

export interface OrderTerm {
  expression: string;
  direction: 'ASC' | 'DESC';
}

// ORDER BY terms for the list, written against the entity alias so TypeORM maps the properties
// to columns. Status codes come from the enum, never from the request, so inlining them is safe.
export function subscriptionOrder(
  sort: SubscriptionSort,
  alias: string,
): OrderTerm[] {
  switch (sort) {
    case SubscriptionSort.STATUS_THEN_DATE: {
      const groups = Object.entries(STATUS_GROUPS)
        .map(([status, group]) => `WHEN '${status}' THEN ${group}`)
        .join(' ');
      return [
        {
          expression: `CASE ${alias}.status ${groups} END`,
          direction: 'ASC',
        },
        // The date that matters next: the end of a trial, otherwise the next payment (or, for a
        // cancelled subscription, the day it runs or ran until).
        {
          expression: `CASE WHEN ${alias}.status = '${SubscriptionStatus.TRIAL}' THEN ${alias}.trialEndDate ELSE ${alias}.nextBillingDate END`,
          direction: 'ASC',
        },
        // Without case, in Polish order whatever the database locale (lower() folds Polish
        // letters under C.UTF-8 too; only the sorting needs the ICU collation).
        {
          expression: `lower(${alias}.name) COLLATE "${POLISH_COLLATION}"`,
          direction: 'ASC',
        },
        { expression: `${alias}.createdAt`, direction: 'ASC' },
      ];
    }
  }
}
