import {
  Body,
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
import { Public } from '../../shared/decorators/public.decorator.js';
import type { AuthUser } from '../../shared/types/auth-user.js';
import { RegisterDto } from '../dtos/register.dto.js';
import { RequestLinkDto } from '../dtos/request-link.dto.js';
import { VerifyDto } from '../dtos/verify.dto.js';
import { AuthService } from '../services/auth.service.js';
import { SessionService } from '../services/session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  // Answers the same whether or not the address has an account.
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  register(@Body() dto: RegisterDto): Promise<void> {
    return this.auth.register(dto.email);
  }

  // Answers the same whether or not the address has an account.
  @Public()
  @Post('request-link')
  @HttpCode(HttpStatus.ACCEPTED)
  requestLink(@Body() dto: RequestLinkDto): Promise<void> {
    return this.auth.requestLink(dto.email);
  }

  // The only route that consumes a token: mail scanners open the link with GET.
  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() dto: VerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUser> {
    const { user, sessionToken } = await this.auth.verify(
      dto.token,
      request.headers['user-agent'] ?? null,
    );
    this.sessions.setCookie(response, sessionToken);
    return user;
  }

  // For the frontend's routing decisions. A signed-out visitor is a normal case there, and a 401
  // would appear as an error in the browser console on every public page.
  @Public()
  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(@Req() request: Request): Promise<{ user: AuthUser | null }> {
    return { user: await this.sessions.authenticate(request) };
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  // Public and idempotent: a session that has already ended is what signing out asks for, not an
  // error. It can only end the session whose token the request carries.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = this.sessions.readToken(request);
    if (token !== undefined) {
      await this.sessions.revoke(token);
    }
    this.sessions.clearCookie(response);
  }
}
