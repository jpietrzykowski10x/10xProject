import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager, IsNull } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import { MailType } from '../../mail/mail.types.js';
import { MailService } from '../../mail/services/mail.service.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { RoleCode } from '../../shared/types/role-code.js';
import { Role } from '../../users/entities/role.entity.js';
import { UserRole } from '../../users/entities/user-role.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/services/users.service.js';
import { MAGIC_LINK_TTL, PRIVACY_POLICY_VERSION } from '../auth.constants.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { magicLinkMail } from '../mail-templates.js';
import { hashToken, SessionService, toAuthUser } from './session.service.js';

const MAGIC_LINK_TOKEN_BYTES = 32;

interface IssuedLink {
  address: string;
  token: string;
  needsConsentConfirmation: boolean;
}

export interface SignIn {
  user: AuthUser;
  sessionToken: string;
}

// Callers answer the same way whether or not an address has an account, so register and
// requestLink return nothing and mail goes out only after the transaction has committed.
@Injectable()
export class AuthService {
  private readonly frontendUrl: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.frontendUrl = envFromConfig(config).FRONTEND_URL;
  }

  async register(email: string): Promise<void> {
    const address = normalizeEmail(email);
    const link = await this.dataSource.transaction(async (manager) => {
      await this.createUserIfAbsent(manager, address);
      const user = await this.lockActiveUser(manager, address);
      if (user === null) {
        return null;
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

  async requestLink(email: string): Promise<void> {
    const address = normalizeEmail(email);
    const link = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockActiveUser(manager, address);
      return user === null ? null : this.issueLink(manager, user);
    });
    this.sendLink(link);
  }

  // Throwing rolls the transaction back, so a refused token creates nothing. Every failure is the
  // same 401.
  verify(token: string, userAgent: string | null): Promise<SignIn> {
    return this.dataSource.transaction(async (manager) => {
      const consumed = await manager
        .createQueryBuilder()
        .update(MagicLinkToken)
        .set({ usedAt: () => 'now()' })
        .where(
          'token_hash = :tokenHash AND used_at IS NULL AND expires_at > now()',
          { tokenHash: hashToken(token) },
        )
        .returning('user_id')
        .execute();
      const [row] = consumed.raw as { user_id: string }[];
      if (row === undefined) {
        throw new UnauthorizedException();
      }

      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: row.user_id },
        relations: { userRoles: { role: true } },
      });
      if (user === null || !user.isActive) {
        throw new UnauthorizedException();
      }

      await users.update(
        { id: user.id, emailVerifiedAt: IsNull() },
        { emailVerifiedAt: new Date() },
      );
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

  // The row lock serializes token issuing per user, so exactly one unused token survives.
  private async lockActiveUser(
    manager: EntityManager,
    address: string,
  ): Promise<User | null> {
    const user = await manager.getRepository(User).findOne({
      where: { email: address },
      lock: { mode: 'pessimistic_write' },
    });
    return user?.isActive ? user : null;
  }

  // Expects the user's row to be locked by lockActiveUser. Only the newest link works.
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
}
