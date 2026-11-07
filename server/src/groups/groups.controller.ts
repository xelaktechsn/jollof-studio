// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Actor, CurrentUser } from '../auth/actor';
import { UUID } from '../common/validation';
import { AddGroupMembersDto, CreateGroupDto, UpdateGroupDto } from './dto';
import { GroupsService } from './groups.service';

@Controller()
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get('classrooms/:id/groups')
  list(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.groups.list(actor, id);
  }

  @Post('classrooms/:id/groups')
  create(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: CreateGroupDto) {
    return this.groups.create(actor, id, dto);
  }

  @Get('groups/:id')
  get(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.groups.get(actor, id);
  }

  @Patch('groups/:id')
  update(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(actor, id, dto);
  }

  @Post('groups/:id/members')
  @HttpCode(200)
  addMembers(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: AddGroupMembersDto) {
    return this.groups.addMembers(actor, id, dto);
  }

  @Delete('groups/:id/members/:userId')
  @HttpCode(204)
  async removeMember(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Param('userId', UUID) userId: string) {
    await this.groups.removeMember(actor, id, userId);
  }

  @Delete('groups/:id')
  @HttpCode(204)
  async remove(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    await this.groups.remove(actor, id);
  }
}
