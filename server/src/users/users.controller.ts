// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Actor, CurrentUser, Public, Roles } from '../auth/actor';
import type { EnvConfig } from '../config/env';
import { err } from '../common/errors';
import { UUID } from '../common/validation';
import { ChangePasswordDto, CreateTeacherDto, SetPlanDto, UpdateMeDto, UpdateSchoolDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() actor: Actor) {
    return this.users.me(actor);
  }

  @Patch()
  update(@CurrentUser() actor: Actor, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(actor, dto);
  }

  @Post('password')
  @HttpCode(204)
  async password(@CurrentUser() actor: Actor, @Body() dto: ChangePasswordDto) {
    await this.users.changePassword(actor, dto);
  }
}

@Controller('school')
@Roles('admin')
export class SchoolController {
  constructor(private readonly users: UsersService) {}

  @Get('teachers')
  teachers(@CurrentUser() actor: Actor) {
    return this.users.teachers(actor);
  }

  @Post('teachers')
  createTeacher(@CurrentUser() actor: Actor, @Body() dto: CreateTeacherDto) {
    return this.users.createTeacher(actor, dto);
  }

  @Patch()
  update(@CurrentUser() actor: Actor, @Body() dto: UpdateSchoolDto) {
    return this.users.updateSchool(actor, dto.name);
  }
}

@Controller('users')
@Roles('teacher')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post(':id/reset-password')
  @HttpCode(200)
  reset(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.users.resetPassword(actor, id);
  }

  @Patch(':id')
  update(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(actor, id, dto);
  }
}

/** Exploitation : changement de forfait d'une école, protégé par PLATFORM_KEY. */
@Public()
@Controller('platform')
export class PlatformController {
  private readonly keyDigest: Buffer | null;

  constructor(
    private readonly users: UsersService,
    config: ConfigService<EnvConfig, true>,
  ) {
    const key = config.get('PLATFORM_KEY', { infer: true });
    this.keyDigest = key ? createHash('sha256').update(key).digest() : null;
  }

  @Post('schools/:id/plan')
  @HttpCode(200)
  setPlan(@Headers('x-platform-key') key: string | undefined, @Param('id', UUID) id: string, @Body() dto: SetPlanDto) {
    const given = createHash('sha256').update(key ?? '').digest();
    if (!this.keyDigest || !key || !timingSafeEqual(given, this.keyDigest)) throw err.forbidden('Invalid platform key');
    return this.users.setPlan(id, dto);
  }
}
