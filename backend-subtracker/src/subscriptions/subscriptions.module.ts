import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module.js';
import { BudgetController } from './controllers/budget.controller.js';
import { CategoriesController } from './controllers/categories.controller.js';
import { SubscriptionsController } from './controllers/subscriptions.controller.js';
import { CategorySetting } from './entities/category-setting.entity.js';
import { Category } from './entities/category.entity.js';
import { Subscription } from './entities/subscription.entity.js';
import { BudgetSettings } from './entities/budget-settings.entity.js';
import { BudgetService } from './services/budget.service.js';
import { CategoriesSeeder } from './services/categories-seeder.js';
import { CategoriesService } from './services/categories.service.js';
import { SubscriptionLifecycleService } from './services/subscription-lifecycle.service.js';
import { SubscriptionsService } from './services/subscriptions.service.js';
import { TrialReminderService } from './services/trial-reminder.service.js';
import { SubscriptionLifecycleScheduler } from './subscription-lifecycle.scheduler.js';
import { TrialReminderScheduler } from './trial-reminder.scheduler.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      CategorySetting,
      Subscription,
      BudgetSettings,
    ]),
    MailModule,
  ],
  controllers: [
    BudgetController,
    CategoriesController,
    SubscriptionsController,
  ],
  providers: [
    BudgetService,
    CategoriesService,
    SubscriptionsService,
    CategoriesSeeder,
    SubscriptionLifecycleService,
    SubscriptionLifecycleScheduler,
    TrialReminderService,
    TrialReminderScheduler,
  ],
  // For the admin module, which shows an account's data through the same queries.
  exports: [SubscriptionsService, BudgetService],
})
export class SubscriptionsModule {}
