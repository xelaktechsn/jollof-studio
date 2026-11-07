// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { HEX_COLOR } from '../common/colors';
import { Lower, Trim } from '../common/dto';

export class UpdateMeDto {
  @IsOptional() @Trim() @IsString() @Length(1, 100) displayName?: string;
  @IsOptional() @Matches(HEX_COLOR, { message: 'avatarColor must be a #rrggbb color' }) avatarColor?: string;
}

export class ChangePasswordDto {
  @IsString() @Length(1, 128) currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}

export class CreateTeacherDto {
  @Trim() @IsString() @Length(1, 100) displayName: string;
  @Lower() @IsEmail() @MaxLength(254) email: string;
}

export class UpdateSchoolDto {
  @Trim() @IsString() @Length(1, 120) name: string;
}

export class UpdateUserDto {
  @IsOptional() @Trim() @IsString() @Length(1, 100) displayName?: string;
  @IsOptional() @IsBoolean() disabled?: boolean;
}

export class SetPlanDto {
  @IsIn(['trial', 'pro', 'expired']) plan: 'trial' | 'pro' | 'expired';
  // Date ISO 8601 ou null ; contrôlée par le service.
  @IsOptional() trialEndsAt?: string | null;
}
