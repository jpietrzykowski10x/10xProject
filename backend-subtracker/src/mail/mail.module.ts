import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { type EnvConfig, envFromConfig } from '../config/env.js';
import { Mail } from './entities/mail.entity.js';
import { createMailTransport, MAIL_TRANSPORT } from './mail.transport.js';
import { MailService } from './services/mail.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Mail])],
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) =>
        createMailTransport(envFromConfig(config)),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
