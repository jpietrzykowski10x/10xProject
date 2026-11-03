import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../shared/decorators/current-user.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { SessionService } from '../services/session.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly sessions: SessionService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // The guard has already accepted this cookie, so the token is present.
    const token = this.sessions.readToken(request);
    if (token !== undefined) {
      await this.sessions.revoke(token);
    }
    this.sessions.clearCookie(response);
  }
}
