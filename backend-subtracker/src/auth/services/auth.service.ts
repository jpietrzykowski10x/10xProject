import { randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataSource,
  type EntityManager,
  In,
  IsNull,
  MoreThan,
  Raw,
} from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import { Mail } from '../../mail/entities/mail.entity.js';
import {
  type MailOutcome,
  MailStatus,
  MailType,
} from '../../mail/mail.types.js';
import { MailService } from '../../mail/services/mail.service.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { RoleCode } from '../../shared/types/role-code.js';
import { Role } from '../../users/entities/role.entity.js';
import { UserRole } from '../../users/entities/user-role.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';
import { withDenial } from '../../shared/logging/denial.js';
import { AccountBlockedException } from '../account-blocked.exception.js';
import { LinkDenial } from '../auth-denials.js';
import {
  BLOCKED_MAIL_RESEND_INTERVAL,
  MAGIC_LINK_TTL,
  PRIVACY_POLICY_VERSION,
} from '../auth.constants.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { accountBlockedMail, magicLinkMail } from '../mail-templates.js';
import { hashToken, SessionService, toAuthUser } from './session.service.js';

const MAGIC_LINK_TOKEN_BYTES = 32;

interface IssuedLink {
  address: string;
  token: string;
  needsConsentConfirmation: boolean;
}

// A token verify could not use, as the database sees it.
interface RefusedTokenRow {
  id: string;
  usedAt: Date | null;
  live: boolean;
}

// What a link request found under the row lock of the address.
type LinkRequestOutcome =
  | { kind: 'issued'; link: IssuedLink }
  | { kind: 'blocked'; userId: string; address: string }
  | { kind: 'none' };

export interface SignIn {
  user: AuthUser;
  sessionToken: string;
}

// Callers answer the same way whether or not an address has an account, so register and
// requestLink return nothing and mail goes out only after the transaction has committed. The one
// exception is a blocked account: an administrator's decision its owner has to learn about, so it
// gets a 403 with the contact address (AccountBlockedException).
//
// Lock order: the user row first, then its tokens and sessions. Issuing a link, verifying one and
// AccountAccessService all keep it, so they cannot deadlock, and a block that commits first is
// seen by each of them.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Accounts whose mail about the block is being attempted right now (sendBlockedMailOnce).
  private readonly blockedMailInFlight = new Set<string>();
  private readonly frontendUrl: string;
  private readonly supportEmail: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    config: ConfigService<EnvConfig, true>,
  ) {
    const env = envFromConfig(config);
    this.frontendUrl = env.FRONTEND_URL;
    this.supportEmail = env.SUPPORT_EMAIL;
  }

  async register(email: string): Promise<void> {
    const address = normalizeEmail(email);
    const link = await this.dataSource.transaction(async (manager) => {
      await this.createUserIfAbsent(manager, address);
      const user = await this.lockUser(manager, address);
      if (user === null) {
        return null;
      }
      // Before the consents below: a blocked account keeps the ones it has.
      if (!user.isActive) {
        throw new AccountBlockedException(this.supportEmail);
      }
      // Whoever filled in the form may not own the mailbox, so until the address is confirmed the
      // latest consents count. A confirmed account keeps those its owner gave.
      if (user.emailVerifiedAt === null) {
        await manager.getRepository(User).update(
          { id: user.id },
          {
            consentsAcceptedAt: new Date(),
            privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          },
        );
      }
      return this.issueLink(manager, user);
    });
    this.sendLink(link);
  }

  // A blocked account gets the mail about the block again, in case the first one went missing, but
  // at most one attempt per BLOCKED_MAIL_RESEND_INTERVAL.
  async requestLink(email: string): Promise<void> {
    const address = normalizeEmail(email);
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<LinkRequestOutcome> => {
        const user = await this.lockUser(manager, address);
        if (user === null) {
          return { kind: 'none' };
        }
        if (!user.isActive) {
          return { kind: 'blocked', userId: user.id, address: user.email };
        }
        return { kind: 'issued', link: await this.issueLink(manager, user) };
      },
    );
    if (outcome.kind === 'blocked') {
      await this.sendBlockedMailOnce(outcome.userId, outcome.address);
      throw new AccountBlockedException(this.supportEmail);
    }
    this.sendLink(outcome.kind === 'issued' ? outcome.link : null);
  }

  // Throwing rolls the transaction back, so a refused token creates nothing. Every failure but a
  // blocked account is the same 401; the token of a blocked account stays unused. Each refusal
  // carries its reason (LinkDenial) for the log line, with ids only, never the token or its hash.
  verify(token: string, userAgent: string | null): Promise<SignIn> {
    return this.dataSource.transaction(async (manager) => {
      const tokenHash = hashToken(token);
      // Only to learn whose row to lock; the UPDATE below decides whether the token is used up.
      const unused = await manager.getRepository(MagicLinkToken).findOne({
        select: { id: true, userId: true },
        where: {
          tokenHash,
          usedAt: IsNull(),
          expiresAt: Raw((column) => `${column} > now()`),
        },
      });
      if (unused === null) {
        throw await this.refusedLink(manager, tokenHash);
      }
      // `account`, not `user`: the filter's own user= is the signed-in caller, here nobody.
      const ids = { token: unused.id, account: unused.userId };

      // A query of its own, without relations, so the lock covers only the user row.
      const users = manager.getRepository(User);
      const locked = await users.findOne({
        where: { id: unused.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked === null) {
        throw withDenial(new UnauthorizedException(), {
          code: LinkDenial.USER_MISSING,
          ids,
        });
      }
      if (!locked.isActive) {
        throw withDenial(new AccountBlockedException(this.supportEmail), {
          code: LinkDenial.ACCOUNT_BLOCKED,
          ids,
        });
      }

      const consumed = await manager
        .createQueryBuilder()
        .update(MagicLinkToken)
        .set({ usedAt: () => 'now()' })
        .where(
          'token_hash = :tokenHash AND user_id = :userId AND used_at IS NULL AND expires_at > now()',
          { tokenHash, userId: locked.id },
        )
        .execute();
      if (consumed.affected !== 1) {
        throw withDenial(new UnauthorizedException(), {
          code: LinkDenial.RACE,
          ids,
        });
      }

      await users.update(
        { id: locked.id, emailVerifiedAt: IsNull() },
        { emailVerifiedAt: new Date() },
      );
      const user = await users.findOneOrFail({
        where: { id: locked.id },
        relations: { userRoles: { role: true } },
      });
      const sessionToken = await this.sessions.create(
        user.id,
        userAgent,
        manager,
      );
      return { user: toAuthUser(user), sessionToken };
    });
  }

  // Why no usable token has this hash, decided by the database clock like the lookup in verify. A
  // used token counts as used even when it has also expired: the use is the fact worth knowing.
  private async refusedLink(
    manager: EntityManager,
    tokenHash: string,
  ): Promise<UnauthorizedException> {
    const row = await manager
      .getRepository(MagicLinkToken)
      .createQueryBuilder('token')
      .select('token.id', 'id')
      .addSelect('token.used_at', 'usedAt')
      .addSelect('token.expires_at > now()', 'live')
      .where('token.token_hash = :tokenHash', { tokenHash })
      .getRawOne<RefusedTokenRow>();
    if (row === undefined) {
      return withDenial(new UnauthorizedException(), {
        code: LinkDenial.UNKNOWN,
      });
    }
    const code =
      row.usedAt !== null
        ? LinkDenial.USED
        : !row.live
          ? LinkDenial.EXPIRED
          : // Unused and live now, yet not found a moment ago: it changed in between.
            LinkDenial.RACE;
    return withDenial(new UnauthorizedException(), {
      code,
      ids: { token: row.id },
    });
  }

  // ON CONFLICT instead of a prior lookup: losing the race for the unique address is then not an
  // error, and the insert waits for the winner to commit, so the caller sees its row.
  private async createUserIfAbsent(
    manager: EntityManager,
    address: string,
  ): Promise<void> {
    const inserted = await manager
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        email: address,
        consentsAcceptedAt: new Date(),
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      })
      .orIgnore()
      .returning('id')
      .updateEntity(false)
      .execute();
    const [row] = inserted.raw as { id: string }[];
    if (row === undefined) {
      return;
    }

    const role = await manager
      .getRepository(Role)
      .findOneBy({ code: RoleCode.USER });
    if (role === null) {
      throw new Error(`Role ${RoleCode.USER} does not exist in this database`);
    }
    await manager
      .getRepository(UserRole)
      .insert({ userId: row.id, roleId: role.id });
  }

  // The row lock serializes token issuing per user, so exactly one unused token survives, and
  // makes the request wait for a block in progress. null means no account; whether the account is
  // blocked is the caller's decision.
  private lockUser(
    manager: EntityManager,
    address: string,
  ): Promise<User | null> {
    return manager.getRepository(User).findOne({
      where: { email: address },
      lock: { mode: 'pessimistic_write' },
    });
  }

  // Expects the user's row to be locked by lockUser. Only the newest link works.
  private async issueLink(
    manager: EntityManager,
    user: User,
  ): Promise<IssuedLink> {
    const tokens = manager.getRepository(MagicLinkToken);
    await tokens.delete({ userId: user.id, usedAt: IsNull() });

    const token = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url');
    await tokens.insert({
      userId: user.id,
      tokenHash: hashToken(token),
      // The database clock, the same one verify checks the expiry with. MAGIC_LINK_TTL is a
      // constant of the code, never input.
      expiresAt: () => `now() + interval '${MAGIC_LINK_TTL / 1000} seconds'`,
    });
    return {
      address: user.email,
      token,
      needsConsentConfirmation: user.emailVerifiedAt === null,
    };
  }

  // Not awaited, so SMTP time does not show in the response and an SMTP failure cannot affect it.
  // Database work still differs by branch, a timing signal accepted in plan-brief.md for the MVP.
  // sendToUser never rejects: failures go to the audit and the logs.
  private sendLink(link: IssuedLink | null): void {
    if (link === null) {
      return;
    }
    this.fireAndForget(
      this.mail.sendToUser(
        MailType.MAGIC_LINK,
        link.address,
        magicLinkMail({
          // In the fragment, so the token reaches neither proxy logs nor the Referer header.
          link: `${this.frontendUrl}/auth/verify#token=${link.token}`,
          needsConsentConfirmation: link.needsConsentConfirmation,
        }),
      ),
    );
  }

  // At most one attempt per BLOCKED_MAIL_RESEND_INTERVAL. The audit row appears only when the
  // attempt ends (seconds with a refused SMTP login, up to three 30 s timeouts with a hanging
  // server), so an attempt in progress is held in memory, keyed by the account id: a request
  // arriving meanwhile sends nothing. The id is taken before the database is read, so two
  // requests in the same moment cannot both pass. One API process (MyDevil) makes this enough.
  private async sendBlockedMailOnce(
    userId: string,
    address: string,
  ): Promise<void> {
    if (this.blockedMailInFlight.has(userId)) {
      return;
    }
    this.blockedMailInFlight.add(userId);
    let sending: Promise<MailOutcome> | undefined;
    try {
      if (!(await this.blockedMailAttemptedRecently(address))) {
        // Not awaited, like the link.
        sending = this.mail.sendToUser(
          MailType.ACCOUNT_BLOCKED,
          address,
          accountBlockedMail({ contact: this.supportEmail }),
        );
      }
    } finally {
      if (sending === undefined) {
        this.blockedMailInFlight.delete(userId);
      }
    }
    if (sending !== undefined) {
      this.fireAndForget(
        sending.finally(() => this.blockedMailInFlight.delete(userId)),
      );
    }
  }

  // Attempted means an audit row of the mail of the block, SENT or FAILED: a failed one closes the
  // gate too, so an SMTP outage does not bring a new try (and a new failure) with every request;
  // the operator already has the alert.
  private blockedMailAttemptedRecently(address: string): Promise<boolean> {
    return this.dataSource.getRepository(Mail).exists({
      where: {
        type: MailType.ACCOUNT_BLOCKED,
        recipient: address,
        status: In([MailStatus.SENT, MailStatus.FAILED]),
        createdAt: MoreThan(
          new Date(Date.now() - BLOCKED_MAIL_RESEND_INTERVAL),
        ),
      },
    });
  }

  // sendToUser never rejects today; the catch keeps a future error from becoming an unhandled
  // rejection. Only the message is logged, never the address.
  private fireAndForget(sending: Promise<MailOutcome>): void {
    sending.catch((error: unknown) => {
      this.logger.error(
        `Mail sending failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
