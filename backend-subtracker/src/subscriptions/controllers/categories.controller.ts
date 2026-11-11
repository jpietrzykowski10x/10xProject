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
import { CreateCategoryDto } from '../dtos/create-category.dto.js';
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
}
