// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { HEX_COLOR } from '../common/colors';
import { Trim } from '../common/dto';

export class CreateGroupDto {
  @Trim() @IsString() @Length(1, 80) name: string;
  @IsOptional() @Matches(HEX_COLOR, { message: 'color must be a #rrggbb color' }) color?: string;
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) memberIds: string[];
}

export class UpdateGroupDto {
  @IsOptional() @Trim() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @Matches(HEX_COLOR, { message: 'color must be a #rrggbb color' }) color?: string;
}

export class AddGroupMembersDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) userIds: string[];
}
