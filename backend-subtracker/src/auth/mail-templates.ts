import { escapeHtml } from '../mail/escape-html.js';
import type { MailContent } from '../mail/mail.types.js';
import { MAGIC_LINK_TTL } from './auth.constants.js';

const MAGIC_LINK_TTL_MINUTES = MAGIC_LINK_TTL / (60 * 1000);

export interface MagicLinkMailInput {
  link: string;
  // The account has no confirmed address yet, so its consents still await the mailbox owner.
  needsConsentConfirmation: boolean;
}

export function magicLinkMail({
  link,
  needsConsentConfirmation,
}: MagicLinkMailInput): MailContent {
  const paragraphs = [
    `Link jest ważny ${MAGIC_LINK_TTL_MINUTES} minut i działa jeden raz. Nowy link unieważnia poprzednie.`,
    ...(needsConsentConfirmation
      ? [
          'Użycie tego linku potwierdza oświadczenie, że masz ukończone 18 lat, oraz akceptację polityki prywatności SubTrackera.',
        ]
      : []),
    'Jeśli to nie Ty, zignoruj tę wiadomość.',
  ];

  return {
    subject: 'Logowanie do SubTrackera',
    text: [`Otwórz link, aby się zalogować:\n${link}`, ...paragraphs].join(
      '\n\n',
    ),
    html: [
      `<p><a href="${escapeHtml(link)}">Otwórz stronę logowania do SubTrackera</a></p>`,
      ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ].join(''),
  };
}
