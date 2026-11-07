// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Notification, NotificationType } from '../database/entities';
import { RealtimeService } from '../realtime/realtime.service';

export function notificationView(n: Notification) {
  return { id: n.id, type: n.type, data: n.data, readAt: n.readAt, createdAt: n.createdAt };
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    private readonly realtime: RealtimeService,
  ) {}

  /** Enregistre puis pousse l'événement `notification` à chaque destinataire. */
  async notify(userIds: string[], type: NotificationType, data: Record<string, unknown>) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const saved = await this.repo.save(ids.map((userId) => this.repo.create({ userId, type, data })));
    for (const n of saved) this.realtime.toUsers(n.userId, 'notification', { notification: notificationView(n) });
  }

  async list(userId: string, unread: boolean, limit: number) {
    const rows = await this.repo.find({
      where: unread ? { userId, readAt: IsNull() } : { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map(notificationView);
  }

  async markRead(userId: string, ids: string[] | undefined, all: boolean | undefined) {
    if (all) {
      await this.repo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    } else if (ids?.length) {
      await this.repo.update({ userId, id: In(ids), readAt: IsNull() }, { readAt: new Date() });
    }
  }
}
