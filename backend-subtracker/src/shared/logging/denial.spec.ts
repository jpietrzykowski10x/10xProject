import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { denialOf, formatDenial, withDenial } from './denial.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const REQUEST = `GET /admin/users user=${ACTOR} req=22222222-2222-4222-8222-222222222222`;

describe('withDenial / denialOf', () => {
  it('marks the same exception without changing its response or status', () => {
    const exception = new ForbiddenException('Cannot manage this account');
    const before = JSON.stringify(exception.getResponse());

    const marked = withDenial(exception, {
      code: 'role_missing',
      ids: { actor: ACTOR },
    });

    expect(marked).toBe(exception);
    expect(JSON.stringify(marked.getResponse())).toBe(before);
    expect(marked.getStatus()).toBe(403);
    expect(Object.keys(marked)).not.toContain('denial');
    expect(JSON.stringify(marked)).not.toContain('role_missing');
    expect(denialOf(marked)).toEqual({
      code: 'role_missing',
      ids: { actor: ACTOR },
    });
  });

  it('finds no denial on an unmarked exception or on a value that is not an object', () => {
    expect(denialOf(new BadRequestException())).toBeUndefined();
    expect(denialOf(new Error('x'))).toBeUndefined();
    expect(denialOf('x')).toBeUndefined();
    expect(denialOf(null)).toBeUndefined();
  });

  it('lets a later mark replace an earlier one', () => {
    const exception = withDenial(new HttpException('x', 400), { code: 'a' });

    withDenial(exception, { code: 'b' });

    expect(denialOf(exception)?.code).toBe('b');
  });
});

describe('formatDenial', () => {
  it('writes the code, status, request, ids and fields', () => {
    expect(
      formatDenial(
        {
          code: 'admin_cannot_manage',
          ids: { actor: ACTOR, action: 'reset_sessions', why: 'rank' },
        },
        403,
        REQUEST,
      ),
    ).toBe(
      `admin_cannot_manage 403 ${REQUEST} actor=${ACTOR} action=reset_sessions why=rank`,
    );
    expect(
      formatDenial(
        { code: 'validation', fields: ['email', 'items.0.name'] },
        400,
        REQUEST,
      ),
    ).toBe(`validation 400 ${REQUEST} fields=email,items.0.name`);
  });

  it('keeps an origin as it is', () => {
    expect(
      formatDenial(
        {
          code: 'csrf_origin',
          ids: { origin: 'https://app.example.com:8443' },
        },
        403,
        REQUEST,
      ),
    ).toBe(`csrf_origin 403 ${REQUEST} origin=https://app.example.com:8443`);
  });

  it('leaves out empty fields', () => {
    expect(formatDenial({ code: 'validation', fields: [] }, 400, REQUEST)).toBe(
      `validation 400 ${REQUEST}`,
    );
  });

  it('replaces characters outside the allowed sets with ?', () => {
    const line = formatDenial(
      {
        code: 'Bad code!',
        ids: { 'Ke y': 'jan@example.com?x=1 ' },
        fields: ['jan@example.com', 'a b'],
      },
      400,
      REQUEST,
    );

    expect(line).toBe(
      `?ad?code? 400 ${REQUEST} ?e?y=jan?example.com?x?1? fields=jan?example.com,a?b`,
    );
    expect(line).not.toContain('@');
  });
});
