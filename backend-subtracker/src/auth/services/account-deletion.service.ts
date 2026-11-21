import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Mail } from '../../mail/entities/mail.entity.js';
import { ANONYMIZED_RECIPIENT } from '../../mail/mail.types.js';
import { User } from '../../users/entities/user.entity.js';
import { normalizeEmail } from '../../users/normalize-email.js';

// Hard deletion: removing the user row cascades to everything the account owns. The mail archive
// has no foreign key to `user`, so its rows stay, but without the address.
@Injectable()
export class AccountDeletionService {
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
      await manager.getRepository(User).delete({ id: user.id });
    });
  }
}
