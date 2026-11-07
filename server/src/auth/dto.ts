// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Lower, Trim } from '../common/dto';

export class RegisterSchoolDto {
  @Trim() @IsString() @Length(1, 120) schoolName: string;
  @Trim() @IsString() @Length(1, 100) displayName: string;
  @Lower() @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}

export class LoginDto {
  @Lower() @IsString() @Length(1, 254) login: string;
  @IsString() @Length(1, 128) password: string;
}

export class RefreshDto {
  @IsString() @Length(1, 200) refreshToken: string;
}
