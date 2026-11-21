import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, In, Repository } from 'typeorm';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  type AccessChangeHook,
  AccountAccessService,
} from '../../auth/services/account-access.service.js';
import {
  containsPattern,
  LIKE_ESCAPE,
} from '../../shared/database/like-pattern.js';
import { POLISH_COLLATION } from '../../shared/database/polish-collation.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import type { RoleCode } from '../../shared/types/role-code.js';
import { BudgetService } from '../../subscriptions/services/budget.service.js';
import { SubscriptionsService } from '../../subscriptions/services/subscriptions.service.js';
import { UserRole } from '../../users/entities/user-role.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { AdminAction } from '../admin-audit.types.js';
import { canManage, visibleRole } from '../admin-rank.js';
import {
  ADMIN_SEARCH_LIMIT,
  type AdminUserDetail,
  type AdminUserSummary,
} from '../admin-user.types.js';
import type { SearchUsersDto } from '../dtos/search-users.dto.js';
import { AdminAuditService } from './admin-audit.service.js';

export const CANNOT_MANAGE_MESSAGE = 'Cannot manage this account';

const SEARCH_ALIAS = 'user';

// The active roles of each account, counted as toAuthUser counts them; no row means no role.
async function activeRolesOf(
  manager: EntityManager,
  userIds: string[],
): Promise<Map<string, RoleCode[]>> {
  const roles = new Map<string, RoleCode[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) {
    return roles;
  }
  const rows = await manager.getRepository(UserRole).find({
    where: { userId: In(userIds) },
    relations: { role: true },
  });
  for (const row of rows) {
    if (row.role.isActive) {
      roles.get(row.userId)?.push(row.role.code);
    }
  }
  return roles;
}

function toSummary(
  actor: AuthUser,
  user: User,
  roles: RoleCode[],
): AdminUserSummary {
  return {
    id: user.id,
    email: user.email,
    role: visibleRole(roles),
    isActive: user.isActive,
    createdAt: user.createdAt,
    canManage: canManage(actor, { id: user.id, roles }),
  };
}

type AccessChange = (
  userId: string,
  withinTransaction: AccessChangeHook,
) => Promise<User>;

// The administrator's view of other accounts. Every admin may view every account; changing one
// needs a higher rank than its owner's (admin-rank.ts).
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AdminAuditService,
    private readonly access: AccountAccessService,
    private readonly subscriptions: SubscriptionsService,
    private readonly budget: BudgetService,
  ) {}

  // Accounts whose address contains the fragment literally (`%`, `_` and `\` match only
  // themselves), optionally only the blocked ones, in Polish order, at most ADMIN_SEARCH_LIMIT.
  // The roles come from a second query, so the limit counts accounts, not joined rows.
  async search(
    actor: AuthUser,
    { q, blocked }: SearchUsersDto,
  ): Promise<AdminUserSummary[]> {
    const query = this.users.createQueryBuilder(SEARCH_ALIAS);
    if (q !== undefined && q !== '') {
      query.andWhere(
        `${SEARCH_ALIAS}.email ILIKE :pattern ESCAPE '${LIKE_ESCAPE}'`,
        { pattern: containsPattern(q) },
      );
    }
    if (blocked === true) {
      query.andWhere(`${SEARCH_ALIAS}.isActive = false`);
    }
    const users = await query
      .orderBy(`${SEARCH_ALIAS}.email COLLATE "${POLISH_COLLATION}"`, 'ASC')
      .limit(ADMIN_SEARCH_LIMIT)
      .getMany();

    const roles = await activeRolesOf(
      this.users.manager,
      users.map((user) => user.id),
    );
    return users.map((user) =>
      toSummary(actor, user, roles.get(user.id) ?? []),
    );
  }

  // The audit row comes first: when it cannot be written, nothing is read. An account deleted
  // between that row and the reads still answers 404, and the row stays as the attempt.
  async detail(actor: AuthUser, id: string): Promise<AdminUserDetail> {
    if (!(await this.audit.recordView(actor.id, id))) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
    }
    const user = await this.users.findOneBy({ id });
    if (user === null) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
    }
    const [roles, subscriptions, totals, budget] = await Promise.all([
      activeRolesOf(this.users.manager, [id]),
      this.subscriptions.list(id),
      this.subscriptions.totals(id),
      this.budget.get(id),
    ]);
    return {
      user: {
        ...toSummary(actor, user, roles.get(id) ?? []),
        emailVerifiedAt: user.emailVerifiedAt,
      },
      subscriptions,
      totals,
      budget,
    };
  }

  block(actor: AuthUser, id: string): Promise<AdminUserSummary> {
    return this.change(actor, id, AdminAction.BLOCK, (userId, hook) =>
      this.access.block(userId, hook),
    );
  }

  unblock(actor: AuthUser, id: string): Promise<AdminUserSummary> {
    return this.change(actor, id, AdminAction.UNBLOCK, (userId, hook) =>
      this.access.unblock(userId, hook),
    );
  }

  resetSessions(actor: AuthUser, id: string): Promise<AdminUserSummary> {
    return this.change(actor, id, AdminAction.RESET_SESSIONS, (userId, hook) =>
      this.access.resetSessions(userId, hook),
    );
  }

  // The answers come in this order: 404 for an unknown id (AccountAccessService), 403 when the
  // actor does not outrank the account, 409 when its state does not allow the action. The rank is
  // checked before the state, so a refused actor learns nothing about the account. The audit row
  // is written in the action's transaction: a 403 or 409 rolls it back with the change.
  private async change(
    actor: AuthUser,
    id: string,
    action: AdminAction,
    apply: AccessChange,
  ): Promise<AdminUserSummary> {
    let targetRoles: RoleCode[] = [];
    const user = await apply(id, async (manager, locked) => {
      targetRoles =
        (await activeRolesOf(manager, [locked.id])).get(locked.id) ?? [];
      if (!canManage(actor, { id: locked.id, roles: targetRoles })) {
        throw new ForbiddenException(CANNOT_MANAGE_MESSAGE);
      }
      await this.audit.record(manager, actor.id, locked.id, action);
    });
    return toSummary(actor, user, targetRoles);
  }
}
