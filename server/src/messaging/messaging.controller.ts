// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Actor, CurrentUser } from '../auth/actor';
import { UUID } from '../common/validation';
import { ConversationSettingsDto, DirectDto, EditMessageDto, MessagesQuery, PostMessageDto, ReadDto } from './dto';
import { MessagingService } from './messaging.service';

@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  list(@CurrentUser() actor: Actor) {
    return this.messaging.list(actor);
  }

  @Post('conversations/direct')
  @HttpCode(200)
  direct(@CurrentUser() actor: Actor, @Body() dto: DirectDto) {
    return this.messaging.direct(actor, dto.userId);
  }

  @Get('conversations/:id/messages')
  history(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Query() q: MessagesQuery) {
    return this.messaging.history(actor, id, q.before, q.limit ?? 50);
  }

  @Post('conversations/:id/messages')
  post(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: PostMessageDto) {
    return this.messaging.post(actor, id, dto);
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  async read(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: ReadDto) {
    await this.messaging.read(actor, id, dto.messageId);
  }

  @Patch('conversations/:id/settings')
  settings(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: ConversationSettingsDto) {
    return this.messaging.settings(actor, id, dto.studentsCanPost);
  }

  @Patch('messages/:id')
  edit(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: EditMessageDto) {
    return this.messaging.edit(actor, id, dto.body);
  }

  @Delete('messages/:id')
  @HttpCode(204)
  async remove(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    await this.messaging.remove(actor, id);
  }
}
