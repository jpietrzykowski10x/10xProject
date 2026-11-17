import { Body, Controller, Get, Header, Put } from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { UpdateBudgetDto } from '../dtos/update-budget.dto.js';
import { BudgetService } from '../services/budget.service.js';
import type { BudgetResponse } from '../subscription.types.js';

// The settings of the budget page: the duplicate threshold per category (S-07).
@Controller('budget')
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthUser): Promise<BudgetResponse> {
    return this.budget.get(user.id);
  }

  // 400 for the whole request when any category is unknown or another account's; nothing is saved.
  @Put()
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBudgetDto,
  ): Promise<BudgetResponse> {
    return this.budget.update(user.id, dto);
  }
}
