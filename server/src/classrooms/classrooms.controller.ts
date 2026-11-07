// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Actor, CurrentUser, Roles } from '../auth/actor';
import { UUID } from '../common/validation';
import { ClassroomsService } from './classrooms.service';
import { AddMembersDto, AddStudentsDto, CreateClassroomDto, ListClassroomsQuery, UpdateClassroomDto } from './dto';

@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly classrooms: ClassroomsService) {}

  @Get()
  list(@CurrentUser() actor: Actor, @Query() q: ListClassroomsQuery) {
    return this.classrooms.list(actor, q.archived === true);
  }

  @Post()
  @Roles('teacher')
  create(@CurrentUser() actor: Actor, @Body() dto: CreateClassroomDto) {
    return this.classrooms.create(actor, dto);
  }

  @Get(':id')
  get(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.classrooms.get(actor, id);
  }

  @Patch(':id')
  update(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: UpdateClassroomDto) {
    return this.classrooms.update(actor, id, dto);
  }

  @Post(':id/students')
  addStudents(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: AddStudentsDto) {
    return this.classrooms.addStudents(actor, id, dto);
  }

  @Post(':id/members')
  @HttpCode(200)
  addMembers(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: AddMembersDto) {
    return this.classrooms.addMembers(actor, id, dto);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Param('userId', UUID) userId: string) {
    await this.classrooms.removeMember(actor, id, userId);
  }
}
