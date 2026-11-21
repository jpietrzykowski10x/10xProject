import {
  accountBlockedMail,
  accountUnblockedMail,
  sessionsResetMail,
} from './mail-templates.js';

const SIGN_IN = 'https://app.example.com/sign-in';

describe('account access mail', () => {
  describe('accountBlockedMail', () => {
    it('says the administrator blocked the account and gives the contact address', () => {
      const mail = accountBlockedMail({ contact: 'pomoc@example.com' });

      expect(mail.subject).toContain('zablokowane');
      for (const body of [mail.text, mail.html]) {
        expect(body).toContain('zablokowane przez administratora');
        expect(body).toContain('pomoc@example.com');
      }
      expect(mail.html).toContain('href="mailto:pomoc@example.com"');
    });

    it('escapes the contact address only in the HTML', () => {
      const contact = '"x"<script>@example.com';

      const mail = accountBlockedMail({ contact });

      expect(mail.text).toContain(contact);
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('&quot;x&quot;&lt;script&gt;@example.com');
    });
  });

  describe.each([
    [
      'accountUnblockedMail',
      accountUnblockedMail,
      'Możesz się znowu zalogować',
    ],
    [
      'sessionsResetMail',
      sessionsResetMail,
      'wylogował Cię ze wszystkich urządzeń',
    ],
  ])('%s', (_name, template, message) => {
    it('tells what happened and links to the sign-in page', () => {
      const mail = template({ signInLink: SIGN_IN });

      for (const body of [mail.text, mail.html]) {
        expect(body).toContain(message);
        expect(body).toContain(SIGN_IN);
      }
      expect(mail.html).toContain(`href="${SIGN_IN}"`);
    });

    it('escapes the link in the HTML', () => {
      const mail = template({ signInLink: 'https://a.example/"><b>x' });

      expect(mail.html).not.toContain('"><b>');
      expect(mail.html).toContain('&quot;&gt;&lt;b&gt;x');
    });
  });
});
