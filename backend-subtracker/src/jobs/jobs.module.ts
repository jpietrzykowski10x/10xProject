import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module.js';
import { JobRun } from './entities/job-run.entity.js';
import { JobRunService } from './job-run.service.js';

// The register of scheduled job runs, used by the schedulers of the feature modules. Not in
// shared/: it depends on MailService for the operator alert.
@Module({
  imports: [TypeOrmModule.forFeature([JobRun]), MailModule],
  providers: [JobRunService],
  exports: [JobRunService],
})
export class JobsModule {}
