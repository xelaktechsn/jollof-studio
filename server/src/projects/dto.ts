// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { Trim } from '../common/dto';

export class CreateProjectDto {
  @Trim() @IsString() @Length(1, 120) title: string;
  @IsOptional() @Trim() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsOptional() @Trim() @IsString() @MaxLength(500) message?: string | null;
}

export class UpdateProjectDto {
  @IsOptional() @Trim() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(2000) description?: string | null;
}

export class LockDto {
  @IsOptional() @IsBoolean() force?: boolean;
}

export class SaveVersionDto {
  @IsObject() data: Record<string, unknown>;
  @IsOptional() @Trim() @IsString() @MaxLength(500) message?: string | null;
  // Obligatoire : null pour un projet encore vide, sinon la version sur laquelle on a travaillé.
  @ValidateIf((o) => o.baseVersionId !== null) @IsUUID('4') baseVersionId: string | null;
}
