import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
  type ValidationPipeOptions,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString, ValidateNested } from 'class-validator';
import { denialOf } from '../logging/denial.js';
import { LoggingValidationPipe, MAX_LOGGED_FIELDS } from './validation-pipe.js';

const ADDRESS = 'jan.kowalski@example.com';

class ItemDto {
  @IsString()
  name: string;
}

class OrderDto {
  @IsEmail()
  email: string;

  @IsInt()
  count: number;

  @ValidateNested()
  @Type(() => ItemDto)
  item: ItemDto;
}

// The options of the global pipe in app.module.ts.
const OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

const BODY: ArgumentMetadata = { type: 'body', metatype: OrderDto };

async function refusal(
  pipe: ValidationPipe,
  body: object,
): Promise<BadRequestException> {
  try {
    await pipe.transform(body, BODY);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return error;
    }
    throw error;
  }
  throw new Error('The pipe accepted the body');
}

describe('LoggingValidationPipe', () => {
  const pipe = new LoggingValidationPipe(OPTIONS);

  it('answers with the same body as the default pipe', async () => {
    const body = {
      email: 'nie-adres',
      count: 'x',
      item: { name: 1, extra: ADDRESS },
      [ADDRESS]: 1,
      note: 'x',
    };

    const ours = await refusal(pipe, body);
    const theirs = await refusal(new ValidationPipe(OPTIONS), body);

    expect(ours.getResponse()).toEqual(theirs.getResponse());
    expect(ours.getStatus()).toBe(theirs.getStatus());
  });

  it('names the refused fields, nested ones with dots, sorted and without values', async () => {
    const denied = await refusal(pipe, {
      email: ADDRESS.replace('@', ''),
      count: 'x',
      item: { name: 7 },
    });

    expect(denialOf(denied)).toEqual({
      code: 'validation',
      fields: ['count', 'email', 'item.name'],
    });
  });

  it('names a property outside the DTO when it is shaped like an identifier', async () => {
    const denied = await refusal(pipe, {
      email: ADDRESS,
      count: 1,
      item: { name: 'a', extraNested: 1 },
      note: 'x',
    });

    expect(denialOf(denied)).toEqual({
      code: 'validation',
      fields: ['item.extraNested', 'note'],
    });
  });

  it('only counts a property outside the DTO that is not shaped like an identifier', async () => {
    const denied = await refusal(pipe, {
      email: ADDRESS,
      count: 1,
      item: { name: 'a' },
      [ADDRESS]: 1,
      'a.b': 1,
      ['x'.repeat(41)]: 1,
      note: 'x',
    });

    const denial = denialOf(denied);
    expect(denial).toEqual({
      code: 'validation',
      fields: ['note'],
      ids: { unknown: '3' },
    });
    expect(JSON.stringify(denial)).not.toContain(ADDRESS);
  });

  it('names at most MAX_LOGGED_FIELDS fields and counts the rest', async () => {
    const extra = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `extra${String(i).padStart(2, '0')}`,
        1,
      ]),
    );
    const denied = await refusal(pipe, {
      email: ADDRESS,
      count: 1,
      item: { name: 'a' },
      ...extra,
    });

    const denial = denialOf(denied);
    expect(MAX_LOGGED_FIELDS).toBe(20);
    expect(denial?.fields).toHaveLength(20);
    expect(denial?.fields?.[0]).toBe('extra00');
    expect(denial?.ids).toEqual({ more: '10' });
  });

  it('lets a valid body through', async () => {
    await expect(
      pipe.transform({ email: ADDRESS, count: 1, item: { name: 'a' } }, BODY),
    ).resolves.toBeInstanceOf(OrderDto);
  });
});
