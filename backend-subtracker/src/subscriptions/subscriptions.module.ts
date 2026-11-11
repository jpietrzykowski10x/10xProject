import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesController } from './controllers/categories.controller.js';
import { SubscriptionsController } from './controllers/subscriptions.controller.js';
import { Category } from './entities/category.entity.js';
import { Subscription } from './entities/subscription.entity.js';
import { CategoriesSeeder } from './services/categories-seeder.js';
import { CategoriesService } from './services/categories.service.js';
import { SubscriptionsService } from './services/subscriptions.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Subscription])],
  controllers: [CategoriesController, SubscriptionsController],
  providers: [CategoriesService, SubscriptionsService, CategoriesSeeder],
})
export class SubscriptionsModule {}
