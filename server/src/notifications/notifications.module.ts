// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
