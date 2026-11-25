import { POLISH_COLLATION } from '../shared/database/polish-collation.js';
import {
  BillingCycle,
  SubscriptionSort,
  SubscriptionStatus,
} from './subscription.types.js';

// Lower groups come first: running subscriptions, then those ending, then the ended ones.
export const STATUS_GROUPS: Record<SubscriptionStatus, number> = {
  [SubscriptionStatus.ACTIVE]: 0,
  [SubscriptionStatus.TRIAL]: 0,
  [SubscriptionStatus.CANCELLED_PENDING]: 1,
  [SubscriptionStatus.CANCELLED]: 2,
};

type Direction = 'ASC' | 'DESC';

export interface OrderTerm {
  expression: string;
  direction: Direction;
}

function statusGroup(alias: string): OrderTerm {
  const groups = Object.entries(STATUS_GROUPS)
    .map(([status, group]) => `WHEN '${status}' THEN ${group}`)
    .join(' ');
  return { expression: `CASE ${alias}.status ${groups} END`, direction: 'ASC' };
}

// The date that matters next: the end of a trial, otherwise the next payment (or, for a cancelled
// subscription, the day it runs or ran until).
function referenceDate(alias: string, direction: Direction): OrderTerm {
  return {
    expression: `CASE WHEN ${alias}.status = '${SubscriptionStatus.TRIAL}' THEN ${alias}.trialEndDate ELSE ${alias}.nextBillingDate END`,
    direction,
  };
}

// Without case, in Polish order whatever the database locale (lower() folds Polish letters under
// C.UTF-8 too; only the sorting needs the ICU collation).
function name(alias: string, direction: Direction): OrderTerm {
  return {
    expression: `lower(${alias}.name) COLLATE "${POLISH_COLLATION}"`,
    direction,
  };
}

// The exact monthly cost (a yearly price / 12 on numeric, without rounding), so two amounts that
// look equal once rounded to grosze still keep the order of their exact values.
function monthlyAmount(alias: string, direction: Direction): OrderTerm {
  return {
    expression: `CASE ${alias}.billingCycle WHEN '${BillingCycle.YEARLY}' THEN ${alias}.amount / 12 ELSE ${alias}.amount END`,
    direction,
  };
}

function defaultOrder(alias: string): OrderTerm[] {
  return [
    statusGroup(alias),
    referenceDate(alias, 'ASC'),
    name(alias, 'ASC'),
    { expression: `${alias}.createdAt`, direction: 'ASC' },
  ];
}

function sortKey(sort: SubscriptionSort, alias: string): OrderTerm[] {
  switch (sort) {
    case SubscriptionSort.STATUS_THEN_DATE:
      return [];
    case SubscriptionSort.NAME_ASC:
      return [name(alias, 'ASC')];
    case SubscriptionSort.NAME_DESC:
      return [name(alias, 'DESC')];
    case SubscriptionSort.AMOUNT_DESC:
      return [monthlyAmount(alias, 'DESC')];
    case SubscriptionSort.AMOUNT_ASC:
      return [monthlyAmount(alias, 'ASC')];
    case SubscriptionSort.DATE_ASC:
      return [referenceDate(alias, 'ASC')];
    case SubscriptionSort.DATE_DESC:
      return [referenceDate(alias, 'DESC')];
  }
}

// ORDER BY terms for the list, written against the entity alias so TypeORM maps the properties
// to columns. Status and cycle codes come from the enums, never from the request, so inlining them
// is safe. The chosen key goes first, then the default order, and the id last: pages taken with
// OFFSET only stay apart when the order leaves no ties. A default term on the key's expression is
// left out: it adds nothing, and TypeORM keeps ORDER BY as a map by expression, so a repeat would
// overwrite the key's direction.
export function subscriptionOrder(
  sort: SubscriptionSort,
  alias: string,
): OrderTerm[] {
  const key = sortKey(sort, alias);
  const keyed = new Set(key.map((term) => term.expression));
  return [
    ...key,
    ...defaultOrder(alias).filter((term) => !keyed.has(term.expression)),
    { expression: `${alias}.id`, direction: 'ASC' },
  ];
}
