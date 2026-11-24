import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager, IsNull } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import {
  type MailContent,
  type MailOutcome,
  MailType,
} from '../../mail/mail.types.js';
import { MailService } from '../../mail/services/mail.service.js';
import { User } from '../../users/entities/user.entity.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { Session } from '../entities/session.entity.js';
import {
  accountBlockedMail,
  accountUnblockedMail,
  sessionsResetMail,
} from '../mail-templates.js';

export const ACCOUNT_NOT_FOUND_MESSAGE = 'Account not found';

// Runs inside the transaction of a change, right after the account row is locked and before the
// state check, so it sees the account as it was. Throwing rolls the whole change back; a write
// made here (e.g. an audit row) commits together with the change or not at all. It may return the
// id of the audit row it wrote, so the log line of the mail can name the action it reports.
export type AccessChangeHook = (
  manager: EntityManager,
  user: User,
) => Promise<string | void>;

type AccessChange = (manager: EntityManager, user: User) => Promise<void>;

interface ChangeResult {
  user: User;
  auditId: string | undefined;
}

type AccessMailType =
  | MailType.ACCOUNT_BLOCKED
  | MailType.ACCOUNT_UNBLOCKED
  | MailType.SESSIONS_RESET;

// Block, unblock and "sign out everywhere". Each is one transaction under the lock of the user
// row, the lock that issuing and verifying a sign-in link take first too: a link request waiting
// for a block sees the blocked account, and no session is created after the block commits. The
// mail goes out after the commit, so it never reports a change that was rolled back, and it is
// not awaited: sendToUser never rejects, and SMTP time does not hold up the caller.
@Injectable()
export class AccountAccessService {
  private readonly logger = new Logger(AccountAccessService.name);

  private readonly supportEmail: string;
  private readonly signInLink: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    config: ConfigService<EnvConfig, true>,
  ) {
    const env = envFromConfig(config);
    this.supportEmail = env.SUPPORT_EMAIL;
    this.signInLink = `${env.FRONTEND_URL}/sign-in`;
  }

  async block(
    userId: string,
    withinTransaction?: AccessChangeHook,
  ): Promise<User> {
    const { user, auditId } = await this.change(
      userId,
      withinTransaction,
      async (manager, locked) => {
        if (!locked.isActive) {
          throw new ConflictException('The account is already blocked');
        }
        await manager
          .getRepository(User)
          .update({ id: locked.id }, { isActive: false });
        await this.endSessionsAndLinks(manager, locked.id);
        locked.isActive = false;
      },
    );
    this.notify(
      MailType.ACCOUNT_BLOCKED,
      user.email,
      accountBlockedMail({ contact: this.supportEmail }),
      auditId,
    );
    return user;
  }

  // Its old links and sessions were ended by the block, so signing in takes a new link.
  async unblock(
    userId: string,
    withinTransaction?: AccessChangeHook,
  ): Promise<User> {
    const { user, auditId } = await this.change(
      userId,
      withinTransaction,
      async (manager, locked) => {
        if (locked.isActive) {
          throw new ConflictException('The account is not blocked');
        }
        await manager
          .getRepository(User)
          .update({ id: locked.id }, { isActive: true });
        locked.isActive = true;
      },
    );
    this.notify(
      MailType.ACCOUNT_UNBLOCKED,
      user.email,
      accountUnblockedMail({ signInLink: this.signInLink }),
      auditId,
    );
    return user;
  }

  // "Sign out everywhere" for an active account; a blocked one has nothing left to end.
  async resetSessions(
    userId: string,
    withinTransaction?: AccessChangeHook,
  ): Promise<User> {
    const { user, auditId } = await this.change(
      userId,
      withinTransaction,
      async (manager, locked) => {
        if (!locked.isActive) {
          throw new ConflictException('The account is blocked');
        }
        await this.endSessionsAndLinks(manager, locked.id);
      },
    );
    this.notify(
      MailType.SESSIONS_RESET,
      user.email,
      sessionsResetMail({ signInLink: this.signInLink }),
      auditId,
    );
    return user;
  }

  private change(
    userId: string,
    withinTransaction: AccessChangeHook | undefined,
    apply: AccessChange,
  ): Promise<ChangeResult> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (user === null) {
        throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
      }
      const returned = await withinTransaction?.(manager, user);
      const auditId = typeof returned === 'string' ? returned : undefined;
      await apply(manager, user);
      return { user, auditId };
    });
  }

  // Every unused sign-in link of the account goes, and every session still open ends. Expects
  // the user row to be locked, so no link or session appears in the meantime.
  private async endSessionsAndLinks(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    await manager
      .getRepository(MagicLinkToken)
      .delete({ userId, usedAt: IsNull() });
    await manager
      .createQueryBuilder()
      .update(Session)
      .set({ revokedAt: () => 'now()' })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();
  }

  // Not awaited. The line after sending ties the outcome to the admin_audit row of the action
  // (`none` for a change made without one), never to the address.
  private notify(
    type: AccessMailType,
    address: string,
    content: MailContent,
    auditId: string | undefined,
  ): void {
    // sendToUser never rejects today; the catch keeps a future error from becoming an unhandled
    // rejection. Only the message is logged, never the address.
    this.mail
      .sendToUser(type, address, content)
      .then((outcome: MailOutcome) => {
        this.logger.log(
          `${type} mail for admin audit ${auditId ?? 'none'}: ${outcome}`,
        );
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Mail sending failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
