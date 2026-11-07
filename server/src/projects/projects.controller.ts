// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, PipeTransform, Post } from '@nestjs/common';
import { Actor, CurrentUser } from '../auth/actor';
import { err } from '../common/errors';
import { isUuid, UUID } from '../common/validation';
import { CreateProjectDto, LockDto, SaveVersionDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

/** Identifiant de version, ou « current ». */
class VersionIdPipe implements PipeTransform<string, string> {
  transform(v: string) {
    if (v === 'current' || isUuid(v)) return v;
    throw err.validation('versionId must be a UUID or "current"');
  }
}

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('groups/:id/projects')
  list(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.projects.list(actor, id);
  }

  @Post('groups/:id/projects')
  create(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: CreateProjectDto) {
    return this.projects.create(actor, id, dto);
  }

  @Get('projects/:id')
  get(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.projects.get(actor, id);
  }

  @Patch('projects/:id')
  update(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(actor, id, dto);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  async remove(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    await this.projects.remove(actor, id);
  }

  @Get('projects/:id/versions')
  versions(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.projects.versions(actor, id);
  }

  @Get('projects/:id/versions/:versionId')
  version(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Param('versionId', new VersionIdPipe()) versionId: string) {
    return this.projects.version(actor, id, versionId);
  }

  @Post('projects/:id/versions')
  save(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: SaveVersionDto) {
    return this.projects.saveVersion(actor, id, dto);
  }

  @Post('projects/:id/versions/:versionId/restore')
  restore(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Param('versionId', UUID) versionId: string) {
    return this.projects.restore(actor, id, versionId);
  }

  @Post('projects/:id/lock')
  @HttpCode(200)
  lock(@CurrentUser() actor: Actor, @Param('id', UUID) id: string, @Body() dto: LockDto) {
    return this.projects.lock(actor, id, dto.force === true);
  }

  @Post('projects/:id/lock/renew')
  @HttpCode(200)
  renew(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    return this.projects.renew(actor, id);
  }

  @Delete('projects/:id/lock')
  @HttpCode(204)
  async unlock(@CurrentUser() actor: Actor, @Param('id', UUID) id: string) {
    await this.projects.unlock(actor, id);
  }
}
