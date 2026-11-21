import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { UserRole } from '../users/entities/user-role.entity.js';
import { User } from '../users/entities/user.entity.js';
import { AdminUsersController } from './controllers/admin-users.controller.js';
import { AdminAudit } from './entities/admin-audit.entity.js';
import { AdminAuditService } from './services/admin-audit.service.js';
import { AdminUsersService } from './services/admin-users.service.js';

// The administrator's panel (S-09): search, a read-only view of an account and the access actions,
// each leaving a row in admin_audit. The account data comes from the subscriptions module's own
// queries, the access changes from AccountAccessService.
@Module({
  imports: [
    TypeOrmModule.forFeature([AdminAudit, User, UserRole]),
    AuthModule,
    SubscriptionsModule,
  ],
  controllers: [AdminUsersController],
  providers: [AdminAuditService, AdminUsersService],
})
export class AdminModule {}
