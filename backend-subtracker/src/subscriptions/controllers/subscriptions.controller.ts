import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { CreateSubscriptionDto } from '../dtos/create-subscription.dto.js';
import { SubscriptionsService } from '../services/subscriptions.service.js';
import type { SubscriptionResponse } from '../subscription.types.js';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser): Promise<SubscriptionResponse[]> {
    return this.subscriptions.list(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    return this.subscriptions.create(user.id, dto);
  }
}
