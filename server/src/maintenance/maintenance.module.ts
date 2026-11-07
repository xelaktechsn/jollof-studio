// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceService } from './maintenance.service';

@Module({ imports: [AuthModule], providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}
