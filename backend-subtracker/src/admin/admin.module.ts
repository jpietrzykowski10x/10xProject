import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAudit } from './entities/admin-audit.entity.js';

// The administrator's panel (S-09). For now only the audit table; the /admin routes come later.
@Module({
  imports: [TypeOrmModule.forFeature([AdminAudit])],
})
export class AdminModule {}
