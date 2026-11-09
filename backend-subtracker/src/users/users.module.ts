import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { RolesSeeder } from './services/roles-seeder.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, UserRole])],
  providers: [RolesSeeder],
})
export class UsersModule {}
