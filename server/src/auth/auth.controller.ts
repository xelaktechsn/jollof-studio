// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from './actor';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterSchoolDto } from './dto';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register-school')
  @UseGuards(ThrottlerGuard)
  register(@Body() dto: RegisterSchoolDto) {
    return this.auth.registerSchool(dto);
  }

  // 10 essais par minute et par IP (LOGIN_RATE_LIMIT) : freine la devinette de mots de passe.
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }
}
