// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit/audit.service';
import { AccessService } from './common/access.service';
import { PasswordService } from './common/passwords';
import { ENTITIES } from './database/entities';
import { ConversationsService } from './messaging/conversations.service';
import { NotificationsService } from './notifications/notifications.service';
import { RealtimeService } from './realtime/realtime.service';
import { AccountsService } from './users/accounts.service';

/** Services partagés par tous les modules (accès, temps réel, notifications…). */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [AccessService, PasswordService, RealtimeService, NotificationsService, ConversationsService, AccountsService, AuditService],
  exports: [TypeOrmModule, AccessService, PasswordService, RealtimeService, NotificationsService, ConversationsService, AccountsService, AuditService],
})
export class CoreModule {}
