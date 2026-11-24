import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { insertAdminAudit } from '../../admin/admin-audit-insert.js';
import { AdminAction } from '../../admin/admin-audit.types.js';
import { Mail } from '../../mail/entities/mail.entity.js';
import { ANONYMIZED_RECIPIENT } from '../../mail/mail.types.js';
import { User } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';

// Hard deletion: removing the user row cascades to everything the account owns. The mail archive
// has no foreign key to `user`, so its rows stay, but without the address. The deletion itself
// leaves an ACCOUNT_DELETED row in admin_audit (ids only), written in the same transaction.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async delete(userId: string, confirmedEmail: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // The same row lock as issuing a sign-in link, so no link is issued for an account that is
      // being deleted: once this commits, the waiting request finds no user.
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (user === null) {
        // A parallel request deleted it first, like a session that has already ended.
        throw new UnauthorizedException();
      }
      if (normalizeEmail(confirmedEmail) !== user.email) {
        throw new BadRequestException(
          'The address does not match the account.',
        );
      }

      // The error message can quote the address, so it goes too.
      await manager
        .getRepository(Mail)
        .update(
          { recipient: user.email },
          { recipient: ANONYMIZED_RECIPIENT, errorMessage: null },
        );
      // Through the plain function: AdminAuditService lives in AdminModule, which imports this one.
      await insertAdminAudit(manager, {
        action: AdminAction.ACCOUNT_DELETED,
        actorId: user.id,
        targetId: user.id,
      });
      await manager.getRepository(User).delete({ id: user.id });
    });
    this.logger.log(`Account ${userId} deleted`);
  }
}
