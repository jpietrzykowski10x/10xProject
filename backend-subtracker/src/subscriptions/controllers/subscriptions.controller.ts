import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { CreateSubscriptionDto } from '../dtos/create-subscription.dto.js';
import { ListSubscriptionsDto } from '../dtos/list-subscriptions.dto.js';
import { SubscriptionsService } from '../services/subscriptions.service.js';
import type {
  CostTotalsResponse,
  SubscriptionPageResponse,
  SubscriptionResponse,
} from '../subscription.types.js';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  // 400 for an unknown sort or status, a category that is not a UUID, a page below 1, a page size
  // outside 1–100 and any other parameter.
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSubscriptionsDto,
  ): Promise<SubscriptionPageResponse> {
    return this.subscriptions.page(user.id, query);
  }

  // A static path, declared before the routes with :id.
  @Get('totals')
  @Header('Cache-Control', 'no-store')
  totals(@CurrentUser() user: AuthUser): Promise<CostTotalsResponse> {
    return this.subscriptions.totals(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    return this.subscriptions.create(user.id, dto);
  }

  // ParseUUIDPipe answers 400 for an id that is not a UUID before it reaches the query.
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    return this.subscriptions.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.subscriptions.remove(user.id, id);
  }

  // Actions without a body: 404 for another account's or an unknown id, 409 when the status does
  // not allow the action.
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionResponse> {
    return this.subscriptions.cancel(user.id, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionResponse> {
    return this.subscriptions.resume(user.id, id);
  }
}
