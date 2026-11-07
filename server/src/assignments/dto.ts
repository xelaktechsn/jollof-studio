// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Trim } from '../common/dto';

export class AssignmentSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) maxAttempts?: number;
  @IsOptional() @IsIn(['immediately', 'after_return', 'never']) showResults?: 'immediately' | 'after_return' | 'never';
  @IsOptional() @IsInt() @Min(1) @Max(10080) timeLimitMinutes?: number | null;
  @IsOptional() @IsBoolean() allowLate?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) faultPenalty?: number;
}

export class AudienceDto {
  @IsBoolean() all: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) userIds?: string[];
}

export class UpdateAssignmentDto {
  @IsOptional() @IsIn(['exercise', 'evaluation']) kind?: 'exercise' | 'evaluation';
  @IsOptional() @Trim() @IsString() @Length(1, 200) title?: string;
  // Documents, items et projet : contrôlés finement par le service (forme, types de nœuds, tailles).
  @IsOptional() @IsObject() instructions?: Record<string, unknown> | null;
  @IsOptional() @IsArray() items?: unknown[];
  @IsOptional() @IsObject() starterProject?: Record<string, unknown> | null;
  @IsOptional() @ValidateNested() @Type(() => AssignmentSettingsDto) settings?: AssignmentSettingsDto;
  @IsOptional() @ValidateNested() @Type(() => AudienceDto) audience?: AudienceDto;
  @IsOptional() @IsISO8601() dueAt?: string | null;
}

// Pas d'héritage : class-validator cumulerait le @IsOptional du parent sur kind et title.
export class CreateAssignmentDto {
  @IsIn(['exercise', 'evaluation']) kind: 'exercise' | 'evaluation';
  @Trim() @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsObject() instructions?: Record<string, unknown> | null;
  @IsOptional() @IsArray() items?: unknown[];
  @IsOptional() @IsObject() starterProject?: Record<string, unknown> | null;
  @IsOptional() @ValidateNested() @Type(() => AssignmentSettingsDto) settings?: AssignmentSettingsDto;
  @IsOptional() @ValidateNested() @Type(() => AudienceDto) audience?: AudienceDto;
  @IsOptional() @IsISO8601() dueAt?: string | null;
}

export class PublishDto {
  @IsOptional() @IsISO8601() dueAt?: string | null;
}

export class DuplicateDto {
  @IsOptional() @IsUUID('4') classroomId?: string;
}

export class SaveSubmissionDto {
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
  @IsOptional() @IsObject() project?: Record<string, unknown> | null;
  @IsOptional() @IsObject() circuit?: Record<string, unknown> | null;
}

export class GradeDto {
  @IsOptional() @IsObject() itemScores?: Record<string, unknown>;
  @IsOptional() @IsObject() feedback?: Record<string, unknown> | null;
  @IsOptional() @IsBoolean() return?: boolean;
}
