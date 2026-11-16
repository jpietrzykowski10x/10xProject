import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module.js';
import { CategoriesController } from './controllers/categories.controller.js';
import { SubscriptionsController } from './controllers/subscriptions.controller.js';
import { Category } from './entities/category.entity.js';
import { Subscription } from './entities/subscription.entity.js';
import { CategoriesSeeder } from './services/categories-seeder.js';
import { CategoriesService } from './services/categories.service.js';
import { SubscriptionLifecycleService } from './services/subscription-lifecycle.service.js';
import { SubscriptionsService } from './services/subscriptions.service.js';
import { TrialReminderService } from './services/trial-reminder.service.js';
import { SubscriptionLifecycleScheduler } from './subscription-lifecycle.scheduler.js';
import { TrialReminderScheduler } from './trial-reminder.scheduler.js';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Subscription]), MailModule],
  controllers: [CategoriesController, SubscriptionsController],
  providers: [
    CategoriesService,
    SubscriptionsService,
    CategoriesSeeder,
    SubscriptionLifecycleService,
    SubscriptionLifecycleScheduler,
    TrialReminderService,
    TrialReminderScheduler,
  ],
})
export class SubscriptionsModule {}
