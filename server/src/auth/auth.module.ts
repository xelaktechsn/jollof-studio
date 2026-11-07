// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginAttemptsService } from './login-attempts.service';
import { TokensService } from './tokens.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokensService, LoginAttemptsService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [TokensService, LoginAttemptsService],
})
export class AuthModule {}
