import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto.js';
import { CreateSubscriptionDto } from './create-subscription.dto.js';

const CATEGORY_ID = '8312d1ba-9f14-4fe2-b611-ebd2538c2721';

const active = {
  name: 'Netflix',
  categoryId: CATEGORY_ID,
  amount: 43,
  billingCycle: 'monthly',
  paymentMethod: 'credit_card',
  status: 'active',
  nextBillingDate: '2026-11-15',
};

const trial = {
  ...active,
  status: 'trial',
  trialEndDate: '2026-11-20',
  nextBillingDate: '2026-11-20',
};

async function failedProperties(
  body: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(CreateSubscriptionDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('CreateSubscriptionDto', () => {
  it('accepts an active and a trial subscription', async () => {
    expect(await failedProperties(active)).toEqual([]);
    expect(await failedProperties(trial)).toEqual([]);
  });

  describe('name', () => {
    it('trims the name', () => {
      const dto = plainToInstance(CreateSubscriptionDto, {
        ...active,
        name: '  Netflix  ',
      });
      expect(dto.name).toBe('Netflix');
    });

    it.each([
      ['empty', ''],
      ['only spaces', '   '],
      ['over 100 characters', 'a'.repeat(101)],
      ['not a string', 42],
    ])('refuses a name that is %s', async (_case, name) => {
      expect(await failedProperties({ ...active, name })).toEqual(['name']);
    });

    it('accepts 100 characters after trimming', async () => {
      expect(
        await failedProperties({ ...active, name: ` ${'a'.repeat(100)} ` }),
      ).toEqual([]);
    });
  });

  describe('amount', () => {
    it.each([0, 0.01, 43.5, 99999.99])('accepts %s', async (amount) => {
      expect(await failedProperties({ ...active, amount })).toEqual([]);
    });

    it.each([
      ['negative', -1],
      ['above the limit', 100000],
      ['with three decimals', 1.234],
      ['a string', '43.00'],
      ['missing', undefined],
    ])('refuses an amount %s', async (_case, amount) => {
      expect(await failedProperties({ ...active, amount })).toEqual(['amount']);
    });
  });

  describe('dates', () => {
    it('requires trialEndDate for a trial', async () => {
      expect(
        await failedProperties({ ...trial, trialEndDate: undefined }),
      ).toEqual(['trialEndDate']);
      expect(await failedProperties({ ...trial, trialEndDate: null })).toEqual([
        'trialEndDate',
      ]);
    });

    it.each(['active', 'cancelled_pending', 'cancelled'])(
      'refuses trialEndDate for a %s subscription',
      async (status) => {
        expect(
          await failedProperties({
            ...active,
            status,
            trialEndDate: '2026-11-10',
          }),
        ).toEqual(['trialEndDate']);
      },
    );

    it('accepts a null trialEndDate outside a trial', async () => {
      expect(await failedProperties({ ...active, trialEndDate: null })).toEqual(
        [],
      );
    });

    it('refuses a payment before the trial ends', async () => {
      expect(
        await failedProperties({ ...trial, nextBillingDate: '2026-11-19' }),
      ).toEqual(['nextBillingDate']);
    });

    it('accepts a payment on or after the trial end', async () => {
      expect(
        await failedProperties({ ...trial, nextBillingDate: '2026-11-21' }),
      ).toEqual([]);
    });

    it('accepts dates in the past', async () => {
      expect(
        await failedProperties({ ...active, nextBillingDate: '2020-01-01' }),
      ).toEqual([]);
    });

    it.each([
      ['missing', undefined],
      ['with a time', '2026-11-15T00:00:00Z'],
      ['in the Polish format', '15.11.2026'],
      ['that does not exist', '2026-02-31'],
    ])('refuses nextBillingDate %s', async (_case, nextBillingDate) => {
      expect(await failedProperties({ ...active, nextBillingDate })).toEqual([
        'nextBillingDate',
      ]);
    });
  });

  it.each([
    ['billingCycle', 'weekly'],
    ['paymentMethod', 'cash'],
    ['status', 'paused'],
    ['categoryId', 'inne'],
  ])('refuses an unknown %s', async (property, value) => {
    expect(await failedProperties({ ...active, [property]: value })).toEqual([
      property,
    ]);
  });

  it('refuses a userId in the body', async () => {
    expect(await failedProperties({ ...active, userId: CATEGORY_ID })).toEqual([
      'userId',
    ]);
  });
});

describe('CreateCategoryDto', () => {
  const failed = async (name: unknown) =>
    (await validate(plainToInstance(CreateCategoryDto, { name }))).map(
      (error) => error.property,
    );

  it('trims the name and accepts 50 characters', async () => {
    const dto = plainToInstance(CreateCategoryDto, { name: ' Praca ' });
    expect(dto.name).toBe('Praca');
    expect(await failed('a'.repeat(50))).toEqual([]);
  });

  it.each(['', '   ', 'a'.repeat(51)])('refuses "%s"', async (name) => {
    expect(await failed(name)).toEqual(['name']);
  });
});
