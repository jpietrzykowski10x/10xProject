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

// The contact address comes from SUPPORT_EMAIL, the link from FRONTEND_URL: both are escaped in
// the HTML like any other value.

export interface AccountBlockedMailInput {
  contact: string;
}

export function accountBlockedMail({
  contact,
}: AccountBlockedMailInput): MailContent {
  const paragraphs = [
    'Konto w SubTrackerze zostało zablokowane przez administratora. Nie możesz się teraz zalogować.',
  ];
  return {
    subject: 'Konto w SubTrackerze zostało zablokowane',
    text: [...paragraphs, `Kontakt: ${contact}`].join('\n\n'),
    html: [
      ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
      `<p>Kontakt: <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a></p>`,
    ].join(''),
  };
}

export interface SignInAgainMailInput {
  // The sign-in page of the frontend.
  signInLink: string;
}

export function accountUnblockedMail({
  signInLink,
}: SignInAgainMailInput): MailContent {
  return signInAgainMail(
    'Konto w SubTrackerze zostało odblokowane',
    'Administrator odblokował Twoje konto. Możesz się znowu zalogować.',
    signInLink,
  );
}

export function sessionsResetMail({
  signInLink,
}: SignInAgainMailInput): MailContent {
  return signInAgainMail(
    'Wylogowano Cię z SubTrackera',
    'Administrator wylogował Cię ze wszystkich urządzeń. Zaloguj się ponownie.',
    signInLink,
  );
}

function signInAgainMail(
  subject: string,
  message: string,
  signInLink: string,
): MailContent {
  return {
    subject,
    text: [message, `Strona logowania:\n${signInLink}`].join('\n\n'),
    html: [
      `<p>${escapeHtml(message)}</p>`,
      `<p><a href="${escapeHtml(signInLink)}">Otwórz stronę logowania do SubTrackera</a></p>`,
    ].join(''),
  };
}
