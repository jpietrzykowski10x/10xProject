import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator.js';
import { Roles } from '../../shared/decorators/roles.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { RoleCode } from '../../shared/types/role-code.js';
import type { AdminUserDetail, AdminUserSummary } from '../admin-user.types.js';
import { SearchUsersDto } from '../dtos/search-users.dto.js';
import { AdminUsersService } from '../services/admin-users.service.js';

// Other accounts, for administrators only: 401 without a session, 403 for a session without an
// admin role (RolesGuard). The only routes that read another account's data.
@Controller('admin/users')
@Roles([RoleCode.ADMIN, RoleCode.SUPER_ADMIN])
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  search(
    @CurrentUser() actor: AuthUser,
    @Query() query: SearchUsersDto,
  ): Promise<AdminUserSummary[]> {
    return this.adminUsers.search(actor, query);
  }

  // Every view of an account's data leaves a VIEW row in admin_audit; an unknown id leaves none.
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUserDetail> {
    return this.adminUsers.detail(actor, id);
  }

  // Actions without a body: 404 for an unknown id, 403 when the actor does not outrank the
  // account, 409 when its state does not allow the action. The owner gets a mail after the change.
  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  block(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUserSummary> {
    return this.adminUsers.block(actor, id);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUserSummary> {
    return this.adminUsers.unblock(actor, id);
  }

  @Post(':id/reset-sessions')
  @HttpCode(HttpStatus.OK)
  resetSessions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUserSummary> {
    return this.adminUsers.resetSessions(actor, id);
  }
}
