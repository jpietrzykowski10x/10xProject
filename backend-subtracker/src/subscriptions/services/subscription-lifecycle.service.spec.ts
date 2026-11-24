import { Logger } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { JobStepError } from '../../jobs/job-run.types.js';
import type { Subscription } from '../entities/subscription.entity.js';
import { BillingCycle } from '../subscription.types.js';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service.js';

const TODAY = '2026-11-24';

interface OverdueRow {
  id: string;
  billingCycle: BillingCycle;
  nextBillingDate: string;
}

const OVERDUE: OverdueRow[] = [
  {
    id: 'sub-1',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: '2026-11-20',
  },
  {
    id: 'sub-2',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: '2026-11-21',
  },
  {
    id: 'sub-3',
    billingCycle: BillingCycle.YEARLY,
    nextBillingDate: '2026-11-22',
  },
];

function queryFailed(code: string): QueryFailedError {
  return new QueryFailedError(
    'UPDATE "subscription" …',
    [],
    Object.assign(new Error('date/time field value out of range'), { code }),
  );
}

// Every createQueryBuilder() call returns the same chain; execute() answers the UPDATEs in order
// (trials, cancellations, then one per overdue row) and getMany() the read of the overdue rows.
function setup() {
  const execute = vi.fn<() => Promise<{ affected: number }>>();
  const getMany = vi.fn<() => Promise<OverdueRow[]>>(() =>
    Promise.resolve(OVERDUE),
  );
  const chain = {
    update: () => chain,
    set: () => chain,
    select: () => chain,
    where: () => chain,
    andWhere: () => chain,
    execute,
    getMany,
  };
  const subscriptions = { createQueryBuilder: () => chain };
  const service = new SubscriptionLifecycleService(
    subscriptions as unknown as Repository<Subscription>,
  );
  return { service, execute, getMany };
}

describe('SubscriptionLifecycleService', () => {
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rolls the other rows when one fails, counts the failure and logs its id', async () => {
    const { service, execute } = setup();
    execute
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockRejectedValueOnce(queryFailed('22008'))
      .mockResolvedValueOnce({ affected: 1 });

    const result = await service.advance(TODAY);

    expect(result).toEqual({
      trialsActivated: 1,
      cancellationsCompleted: 0,
      billingDatesRolled: 2,
      billingRollFailed: 1,
    });
    // The scheduler reports the run as partial when billingRollFailed > 0.
    expect(result.billingRollFailed > 0).toBe(true);
    expect(execute).toHaveBeenCalledTimes(5);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      'Rolling the billing date of subscription sub-2 failed (code: 22008)',
    );
  });

  it('reports no failed rows when every row rolls', async () => {
    const { service, execute } = setup();
    execute.mockResolvedValue({ affected: 1 });

    const result = await service.advance(TODAY);

    expect(result.billingDatesRolled).toBe(3);
    expect(result.billingRollFailed).toBe(0);
    expect(logError).not.toHaveBeenCalled();
  });

  it('names the step of a failed transition', async () => {
    const { service, execute } = setup();
    const cause = queryFailed('57014');
    execute.mockRejectedValueOnce(cause);

    const error: unknown = await service
      .advance(TODAY)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JobStepError);
    expect((error as JobStepError).step).toBe('trial_to_active');
    expect((error as JobStepError).cause).toBe(cause);
  });

  it('names the step of the cancellations', async () => {
    const { service, execute } = setup();
    execute
      .mockResolvedValueOnce({ affected: 0 })
      .mockRejectedValueOnce(queryFailed('57014'));

    await expect(service.advance(TODAY)).rejects.toMatchObject({
      step: 'cancelled_pending_to_cancelled',
    });
  });

  it('fails the roll_billing_dates step when the overdue rows cannot be read', async () => {
    const { service, execute, getMany } = setup();
    execute.mockResolvedValue({ affected: 0 });
    getMany.mockRejectedValueOnce(queryFailed('57014'));

    await expect(service.advance(TODAY)).rejects.toMatchObject({
      name: 'JobStepError',
      step: 'roll_billing_dates',
    });
  });
});
