import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { CLEANUP_RETENTION } from '../auth.constants.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { Session } from '../entities/session.entity.js';

// The number of rows one run deleted.
export interface AuthCleanupResult {
  tokens: number;
  sessions: number;
}

// Deletes sign-in tokens and sessions that stopped working more than CLEANUP_RETENTION ago, over
// every account. Each run deletes everything past the limit, so a missed run is caught up by the
// next one and a second run right after changes nothing.
@Injectable()
export class AuthCleanupService {
  constructor(
    @InjectRepository(MagicLinkToken)
    private readonly tokens: Repository<MagicLinkToken>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {}

  async purge(now: Date): Promise<AuthCleanupResult> {
    const limit = new Date(now.getTime() - CLEANUP_RETENTION);
    const tokens = await this.tokens.delete({ expiresAt: LessThan(limit) });
    // Two queries, so each can use its own index.
    const expired = await this.sessions.delete({ expiresAt: LessThan(limit) });
    const revoked = await this.sessions.delete({ revokedAt: LessThan(limit) });
    return {
      tokens: tokens.affected ?? 0,
      sessions: (expired.affected ?? 0) + (revoked.affected ?? 0),
    };
  }
}
