import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';
import { type EntityManager, IsNull, Repository } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import type { User } from '../../users/entities/user.entity.js';
import { SESSION_COOKIE_NAME, SESSION_TTL } from '../auth.constants.js';
import {
  Session,
  SESSION_USER_AGENT_MAX_LENGTH,
} from '../entities/session.entity.js';

const SESSION_TOKEN_BYTES = 32;

// A random high-entropy token does not need a slow hash.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Expects user.userRoles with their roles loaded. Only active roles count towards permissions.
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    roles: user.userRoles
      .filter((userRole) => userRole.role.isActive)
      .map((userRole) => userRole.role.code),
  };
}

@Injectable()
export class SessionService {
  private readonly cookieOptions: CookieOptions;

  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    config: ConfigService<EnvConfig, true>,
  ) {
    const env = envFromConfig(config);
    this.cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: env.MODE === 'PROD',
      domain: env.SESSION_COOKIE_DOMAIN,
    };
  }

  // Returns the raw token, which exists only here and in the cookie. The expiry is fixed at
  // creation and never extended. Pass `manager` to create the session inside a transaction.
  async create(
    userId: string,
    userAgent: string | null,
    manager: EntityManager = this.sessions.manager,
  ): Promise<string> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    await manager.getRepository(Session).insert({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL),
      userAgent: userAgent?.slice(0, SESSION_USER_AGENT_MAX_LENGTH) ?? null,
    });
    return token;
  }

  readToken(request: Request): string | undefined {
    const header = request.headers.cookie;
    return header === undefined
      ? undefined
      : parseCookie(header)[SESSION_COOKIE_NAME];
  }

  // Loads the owner and their roles too, so the guard needs no further queries. Deciding whether
  // the session is still valid is up to the caller.
  findByToken(token: string): Promise<Session | null> {
    return this.sessions.findOne({
      where: { tokenHash: hashToken(token) },
      relations: { user: { userRoles: { role: true } } },
    });
  }

  async revoke(token: string): Promise<void> {
    await this.sessions.update(
      { tokenHash: hashToken(token), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  setCookie(response: Response, token: string): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      ...this.cookieOptions,
      maxAge: SESSION_TTL,
    });
  }

  clearCookie(response: Response): void {
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions);
  }
}
