import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  SUBSCRIPTION_PAGE_MAX,
  SUBSCRIPTION_PAGE_SIZE,
  SUBSCRIPTION_PAGE_SIZE_MAX,
  SubscriptionSort,
  SubscriptionStatus,
} from '../subscription.types.js';

// GET /subscriptions?sort=&category=&status=&page=&pageSize=. Query values arrive as strings, so
// the numbers go through @Type(); a missing parameter keeps its default. A category of another
// account (or none at all) is not refused here: the query is scoped to the account and finds
// nothing.
export class ListSubscriptionsDto {
  @IsOptional()
  @IsEnum(SubscriptionSort)
  sort: SubscriptionSort = SubscriptionSort.STATUS_THEN_DATE;

  @IsOptional()
  @IsUUID()
  category?: string;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUBSCRIPTION_PAGE_MAX)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUBSCRIPTION_PAGE_SIZE_MAX)
  pageSize: number = SUBSCRIPTION_PAGE_SIZE;
}
