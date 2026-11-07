// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Actor, CurrentUser } from '../auth/actor';
import { QueryBool } from '../common/dto';
import { NotificationsService } from './notifications.service';

class ListQuery {
  @IsOptional() @QueryBool() @IsBoolean() unread?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class ReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() actor: Actor, @Query() q: ListQuery) {
    return this.notifications.list(actor.id, q.unread === true, q.limit ?? 50);
  }

  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() actor: Actor, @Body() dto: ReadDto) {
    await this.notifications.markRead(actor.id, dto.ids, dto.all);
  }
}
