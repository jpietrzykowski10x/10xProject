import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module.js';
import { RolesGuard } from '../shared/guards/roles.guard.js';
import { AuthController } from './controllers/auth.controller.js';
import { MagicLinkToken } from './entities/magic-link-token.entity.js';
import { Session } from './entities/session.entity.js';
import { SessionAuthGuard } from './guards/session-auth.guard.js';
import { AuthService } from './services/auth.service.js';
import { SessionService } from './services/session.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session, MagicLinkToken]), MailModule],
  controllers: [AuthController],
  providers: [
    SessionService,
    AuthService,
    // Global guards run in this order: RolesGuard reads the request.user set by SessionAuthGuard.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
