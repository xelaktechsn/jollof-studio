// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Module } from '@nestjs/common';
import { AuditController } from '../audit/audit.controller';
import { AuthModule } from '../auth/auth.module';
import { MeController, PlatformController, SchoolController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [MeController, SchoolController, AuditController, UsersController, PlatformController],
  providers: [UsersService],
})
export class UsersModule {}
