// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Module } from '@nestjs/common';
import { AssignmentsController, ClassroomAssignmentsController, MyAssignmentsController, SubmissionsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { SubmissionsService } from './submissions.service';

@Module({
  controllers: [ClassroomAssignmentsController, AssignmentsController, SubmissionsController, MyAssignmentsController],
  providers: [AssignmentsService, SubmissionsService],
})
export class AssignmentsModule {}
