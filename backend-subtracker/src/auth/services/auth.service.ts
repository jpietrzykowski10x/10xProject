import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager, IsNull, Raw } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import { MailType } from '../../mail/mail.types.js';
import { MailService } from '../../mail/services/mail.service.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { RoleCode } from '../../shared/types/role-code.js';
import { Role } from '../../users/entities/role.entity.js';
import { UserRole } from '../../users/entities/user-role.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';
import { AccountBlockedException } from '../account-blocked.exception.js';
import { MAGIC_LINK_TTL, PRIVACY_POLICY_VERSION } from '../auth.constants.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { accountBlockedMail, magicLinkMail } from '../mail-templates.js';
import { hashToken, SessionService, toAuthUser } from './session.service.js';

const MAGIC_LINK_TOKEN_BYTES = 32;

interface IssuedLink {
  address: string;
  token: string;
  needsConsentConfirmation: boolean;
}

// What a link request found under the row lock of the address.
type LinkRequestOutcome =
  | { kind: 'issued'; link: IssuedLink }
  | { kind: 'blocked'; address: string }
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

  // A blocked account gets the mail about the block again, in case the first one went missing.
  async requestLink(email: string): Promise<void> {
    const address = normalizeEmail(email);
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<LinkRequestOutcome> => {
        const user = await this.lockUser(manager, address);
        if (user === null) {
          return { kind: 'none' };
        }
        if (!user.isActive) {
          return { kind: 'blocked', address: user.email };
        }
        return { kind: 'issued', link: await this.issueLink(manager, user) };
      },
    );
    if (outcome.kind === 'blocked') {
      this.sendBlockedMail(outcome.address);
      throw new AccountBlockedException(this.supportEmail);
    }
    this.sendLink(outcome.kind === 'issued' ? outcome.link : null);
  }

  // Throwing rolls the transaction back, so a refused token creates nothing. Every failure but a
  // blocked account is the same 401; the token of a blocked account stays unused.
  verify(token: string, userAgent: string | null): Promise<SignIn> {
    return this.dataSource.transaction(async (manager) => {
      const tokenHash = hashToken(token);
      // Only to learn whose row to lock; the UPDATE below decides whether the token is used up.
      const unused = await manager.getRepository(MagicLinkToken).findOne({
        select: { userId: true },
        where: {
          tokenHash,
          usedAt: IsNull(),
          expiresAt: Raw((column) => `${column} > now()`),
        },
      });
      if (unused === null) {
        throw new UnauthorizedException();
      }

      // A query of its own, without relations, so the lock covers only the user row.
      const users = manager.getRepository(User);
      const locked = await users.findOne({
        where: { id: unused.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked === null) {
        throw new UnauthorizedException();
      }
      if (!locked.isActive) {
        throw new AccountBlockedException(this.supportEmail);
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
        throw new UnauthorizedException();
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
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL),
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
    void this.mail.sendToUser(
      MailType.MAGIC_LINK,
      link.address,
      magicLinkMail({
        // In the fragment, so the token reaches neither proxy logs nor the Referer header.
        link: `${this.frontendUrl}/auth/verify#token=${link.token}`,
        needsConsentConfirmation: link.needsConsentConfirmation,
      }),
    );
  }

  // Not awaited, like the link.
  private sendBlockedMail(address: string): void {
    void this.mail.sendToUser(
      MailType.ACCOUNT_BLOCKED,
      address,
      accountBlockedMail({ contact: this.supportEmail }),
    );
  }
}
