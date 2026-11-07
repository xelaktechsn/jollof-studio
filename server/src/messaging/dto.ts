// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Trim } from '../common/dto';

export class DirectDto {
  @IsUUID('4') userId: string;
}

export class MessagesQuery {
  @IsOptional() @IsUUID('4') before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class PostMessageDto {
  @Trim() @IsString() @Length(1, 4000) body: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('4', { each: true }) attachmentIds?: string[];
}

export class EditMessageDto {
  @Trim() @IsString() @Length(1, 4000) body: string;
}

export class ReadDto {
  @IsUUID('4') messageId: string;
}

export class ConversationSettingsDto {
  @IsBoolean() studentsCanPost: boolean;
}
