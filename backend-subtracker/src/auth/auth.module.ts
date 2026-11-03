import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesGuard } from '../shared/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { Session } from './entities/session.entity.js';
import { SessionAuthGuard } from './guards/session-auth.guard.js';
import { SessionService } from './services/session.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session]), UsersModule],
  controllers: [AuthController],
  providers: [
    SessionService,
    // Global guards run in this order: RolesGuard reads the request.user set by SessionAuthGuard.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
