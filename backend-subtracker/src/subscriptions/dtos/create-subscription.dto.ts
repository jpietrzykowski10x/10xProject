import {
  IsEnum,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import {
  AMOUNT_MAX,
  BillingCycle,
  PaymentMethod,
  SUBSCRIPTION_NAME_MAX_LENGTH,
  SubscriptionStatus,
} from '../subscription.types.js';
import { IsDateOnly, isDateOnly } from '../../shared/validation/date-only.js';
import { TrimmedString } from '../../shared/validation/trimmed-string.js';

const statusOf = (args: ValidationArguments): unknown =>
  (args.object as Partial<CreateSubscriptionDto>).status;

// Required for a trial, refused for every other status (absent or null passes there).
const TrialEndDateRule = () =>
  ValidateBy({
    name: 'trialEndDateRule',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        args !== undefined && statusOf(args) === SubscriptionStatus.TRIAL
          ? isDateOnly(value)
          : value === undefined || value === null,
      defaultMessage: () =>
        'trialEndDate must be a date in the YYYY-MM-DD format for a trial and must be absent otherwise',
    },
  });

// For a trial, the first payment cannot come before the trial ends.
const NotBeforeTrialEnd = () =>
  ValidateBy({
    name: 'notBeforeTrialEnd',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        if (args === undefined || statusOf(args) !== SubscriptionStatus.TRIAL) {
          return true;
        }
        const { trialEndDate } = args.object as Partial<CreateSubscriptionDto>;
        // An invalid trialEndDate has its own error.
        return (
          !isDateOnly(value) ||
          !isDateOnly(trialEndDate) ||
          value >= trialEndDate
        );
      },
      defaultMessage: () =>
        'nextBillingDate must not be earlier than trialEndDate',
    },
  });

// Dates in the past are allowed: a subscription can be recorded long after it started.
export class CreateSubscriptionDto {
  @TrimmedString(SUBSCRIPTION_NAME_MAX_LENGTH)
  name: string;

  @IsUUID()
  categoryId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(AMOUNT_MAX)
  amount: number;

  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus;

  @TrialEndDateRule()
  trialEndDate?: string | null;

  @IsDateOnly()
  @NotBeforeTrialEnd()
  nextBillingDate: string;
}
