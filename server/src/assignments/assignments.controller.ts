// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { Actor, CurrentUser } from '../auth/actor';
import { UUID } from '../common/validation';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto, DuplicateDto, GradeDto, PublishDto, SaveSubmissionDto, UpdateAssignmentDto } from './dto';
import { SubmissionsService } from './submissions.service';

@Controller('classrooms/:id')
export class ClassroomAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get('assignments')
  list(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.assignments.listForClassroom(actor, id);
  }

  @Post('assignments')
  create(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: CreateAssignmentDto) {
    return this.assignments.create(actor, id, dto);
  }

  @Get('grades')
  grades(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.assignments.grades(actor, id);
  }
}

@Controller('assignments/:id')
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly submissions: SubmissionsService,
  ) {}

  @Get()
  get(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.assignments.get(actor, id);
  }

  @Patch()
  update(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: UpdateAssignmentDto) {
    return this.assignments.update(actor, id, dto);
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    await this.assignments.remove(actor, id);
  }

  @Post('publish')
  @HttpCode(200)
  publish(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: PublishDto) {
    return this.assignments.publish(actor, id, dto.dueAt);
  }

  @Post('close')
  @HttpCode(200)
  close(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.assignments.close(actor, id);
  }

  @Post('duplicate')
  duplicate(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: DuplicateDto) {
    return this.assignments.duplicate(actor, id, dto.classroomId);
  }

  @Post('start')
  @HttpCode(200)
  start(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.submissions.start(actor, id);
  }

  @Get('submissions')
  submissionsList(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.submissions.listForAssignment(actor, id);
  }

  @Get('my-submissions')
  mine(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.submissions.mine(actor, id);
  }
}

@Controller('submissions/:id')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  get(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.submissions.get(actor, id);
  }

  @Put()
  save(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: SaveSubmissionDto) {
    return this.submissions.write(actor, id, dto, false);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: SaveSubmissionDto) {
    return this.submissions.write(actor, id, dto, true);
  }

  @Post('grade')
  @HttpCode(200)
  grade(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: GradeDto) {
    return this.submissions.grade(actor, id, dto);
  }
}

@Controller('me')
export class MyAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get('assignments')
  mine(@CurrentUser() actor: Actor) {
    return this.assignments.forMe(actor);
  }
}
