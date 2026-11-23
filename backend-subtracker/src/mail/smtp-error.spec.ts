import { enhancedStatusOf, isRecipientTypo } from './smtp-error.js';

function smtpError(command: string, response: unknown) {
  const responseCode =
    typeof response === 'string' ? Number(/^\d+/.exec(response)?.[0]) : NaN;
  return Object.assign(new Error('Recipient command failed'), {
    code: 'EENVELOPE',
    command,
    response,
    responseCode: Number.isNaN(responseCode) ? undefined : responseCode,
  });
}

describe('enhancedStatusOf', () => {
  it.each([
    ['550 5.1.1 <jan@example.com>: user unknown', '5.1.1'],
    ['550-5.1.10 RESOLVER.ADR.RecipientNotFound', '5.1.10'],
    ['550 5.7.1 relaying denied', '5.7.1'],
    ['550 mailbox unavailable', undefined],
    ['452 4.5.3 too many recipients', '4.5.3'],
  ])('reads %j as %j', (response, status) => {
    expect(enhancedStatusOf(smtpError('RCPT TO', response))).toBe(status);
  });

  it.each([undefined, 550, { text: '550 5.1.1' }])(
    'returns undefined for a response %j that is not a string',
    (response) => {
      expect(enhancedStatusOf(smtpError('RCPT TO', response))).toBeUndefined();
    },
  );

  it.each([null, 'text', 42])('returns undefined for %j', (error) => {
    expect(enhancedStatusOf(error)).toBeUndefined();
  });
});

describe('isRecipientTypo', () => {
  it.each([
    ['550 5.1.1 user unknown', true],
    ['550-5.1.10 recipient not found', true],
    ['550 5.7.1 relaying denied', false],
    ['550 mailbox unavailable', false],
    ['452 4.5.3 too many recipients', false],
    ['450 4.1.1 try again later', false],
  ])('treats a RCPT TO answered %j as a typo: %s', (response, typo) => {
    expect(isRecipientTypo(smtpError('RCPT TO', response))).toBe(typo);
  });

  it('does not treat a refused sender as a typo', () => {
    expect(
      isRecipientTypo(smtpError('MAIL FROM', '550 5.1.8 bad sender domain')),
    ).toBe(false);
  });

  it('does not treat a response that is not a string as a typo', () => {
    expect(
      isRecipientTypo(
        Object.assign(new Error('x'), {
          code: 'EENVELOPE',
          command: 'RCPT TO',
          responseCode: 550,
          response: { status: '5.1.1' },
        }),
      ),
    ).toBe(false);
  });

  it('does not treat another error code as a typo', () => {
    expect(
      isRecipientTypo(
        Object.assign(smtpError('RCPT TO', '550 5.1.1 user unknown'), {
          code: 'EAUTH',
        }),
      ),
    ).toBe(false);
  });
});
