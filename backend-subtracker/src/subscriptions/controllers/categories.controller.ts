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
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/decorators/current-user.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { CreateCategoryDto } from '../dtos/create-category.dto.js';
import { RenameCategoryDto } from '../dtos/rename-category.dto.js';
import { CategoriesService } from '../services/categories.service.js';
import type { CategoryResponse } from '../subscription.types.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser): Promise<CategoryResponse[]> {
    return this.categories.list(user.id);
  }

  // 409 when the user already has the name, or a default has it, whatever the case.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.create(user.id, dto.name);
  }

  // Only the user's own category: 404 for a default, another account's or an unknown id; 409 when
  // another own category or a default has the name, whatever the case.
  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.rename(user.id, id, dto.name);
  }

  // Only an own category without subscriptions: 404 as above, 409 while it has subscriptions.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.categories.remove(user.id, id);
  }
}
