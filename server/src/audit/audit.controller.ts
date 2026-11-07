// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Actor, CurrentUser, Roles } from '../auth/actor';
import { AuditService } from './audit.service';

class AuditQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() @Matches(/^\d{1,18}$/, { message: 'before must be an audit entry id' }) before?: string;
}

/** GET /school/audit : journal de l'école, réservé à l'administrateur. */
@Controller('school')
@Roles('admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit')
  list(@CurrentUser() actor: Actor, @Query() q: AuditQuery) {
    return this.audit.list(actor.schoolId, q.limit ?? 100, q.before);
  }
}
