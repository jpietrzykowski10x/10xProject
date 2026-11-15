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
} from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { CreateSubscriptionDto } from '../dtos/create-subscription.dto.js';
import { SubscriptionsService } from '../services/subscriptions.service.js';
import type {
  CostTotalsResponse,
  SubscriptionResponse,
} from '../subscription.types.js';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser): Promise<SubscriptionResponse[]> {
    return this.subscriptions.list(user.id);
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
}
