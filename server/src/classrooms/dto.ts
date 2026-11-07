// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { HEX_COLOR } from '../common/colors';
import { Lower, QueryBool, Trim } from '../common/dto';
import { USERNAME_RE } from '../common/usernames';

export class ClassroomSettingsDto {
  @IsOptional() @IsBoolean() allowStudentGroups?: boolean;
  @IsOptional() @IsInt() @Min(2) @Max(50) maxGroupSize?: number;
  @IsOptional() @IsBoolean() allowStudentDirectMessages?: boolean;
}

export class CreateClassroomDto {
  @Trim() @IsString() @Length(1, 120) name: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) subject?: string | null;
  @IsOptional() @Trim() @IsString() @MaxLength(60) level?: string | null;
  @IsOptional() @Matches(HEX_COLOR, { message: 'color must be a #rrggbb color' }) color?: string;
  @IsOptional() @ValidateNested() @Type(() => ClassroomSettingsDto) settings?: ClassroomSettingsDto;
}

export class UpdateClassroomDto {
  @IsOptional() @Trim() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) subject?: string | null;
  @IsOptional() @Trim() @IsString() @MaxLength(60) level?: string | null;
  @IsOptional() @Matches(HEX_COLOR, { message: 'color must be a #rrggbb color' }) color?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @ValidateNested() @Type(() => ClassroomSettingsDto) settings?: ClassroomSettingsDto;
}

export class NewStudentDto {
  @Trim() @IsString() @Length(1, 100) displayName: string;
  @IsOptional() @Lower() @Matches(USERNAME_RE, { message: 'username: 2-40 characters a-z 0-9 . _ -' }) username?: string;
}

export class AddStudentsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => NewStudentDto) students: NewStudentDto[];
  @IsOptional() @IsBoolean() requirePasswordChange?: boolean;
}

export class AddMembersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('4', { each: true }) userIds: string[];
}

export class ListClassroomsQuery {
  @IsOptional() @QueryBool() @IsBoolean() archived?: boolean;
}
