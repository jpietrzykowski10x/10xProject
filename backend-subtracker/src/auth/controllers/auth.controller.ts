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
