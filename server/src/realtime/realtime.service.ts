// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';

export const rooms = {
  user: (id: string) => `user:${id}`,
  conv: (id: string) => `conv:${id}`,
  group: (id: string) => `group:${id}`,
  class: (id: string) => `class:${id}`,
};

// Émetteur temps réel utilisé par les services. Sans passerelle (script de peuplement,
// contexte sans HTTP), les appels ne font rien. Présence en mémoire : une seule instance.
@Injectable()
export class RealtimeService {
  private ns?: Namespace;
  private readonly online = new Map<string, number>();

  attach(ns: Namespace) {
    this.ns = ns;
  }

  toUsers(userIds: string | string[], event: string, payload: unknown) {
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
    if (!this.ns || ids.length === 0) return;
    this.ns.to(ids.map(rooms.user)).emit(event, payload);
  }

  toRooms(target: string | string[], event: string, payload: unknown) {
    if (!this.ns || (Array.isArray(target) && target.length === 0)) return;
    this.ns.to(target).emit(event, payload);
  }

  /** Fait rejoindre des salles à toutes les sockets ouvertes de ces utilisateurs. */
  join(userIds: string[], targets: string[]) {
    if (!this.ns || userIds.length === 0 || targets.length === 0) return;
    this.ns.in([...new Set(userIds)].map(rooms.user)).socketsJoin(targets);
  }

  leave(userIds: string[], targets: string[]) {
    if (!this.ns || userIds.length === 0 || targets.length === 0) return;
    this.ns.in([...new Set(userIds)].map(rooms.user)).socketsLeave(targets);
  }

  /** Vide une salle (groupe supprimé…) : toutes ses sockets quittent `targets`. */
  evacuate(room: string, targets: string[]) {
    this.ns?.in(room).socketsLeave(targets);
  }

  /** Ferme les sockets de l'utilisateur ; `exceptFamily` : sauf celles de cette session (jeton de rafraîchissement). */
  async disconnectUser(userId: string, exceptFamily?: string) {
    if (!this.ns) return;
    if (!exceptFamily) {
      this.ns.in(rooms.user(userId)).disconnectSockets(true);
      return;
    }
    const sockets = await this.ns.in(rooms.user(userId)).fetchSockets();
    for (const s of sockets) if ((s.data as { user?: { fam?: string } }).user?.fam !== exceptFamily) s.disconnect(true);
  }

  /** Renvoie vrai à la première socket de l'utilisateur. */
  connected(userId: string): boolean {
    const n = (this.online.get(userId) ?? 0) + 1;
    this.online.set(userId, n);
    return n === 1;
  }

  /** Renvoie vrai quand la dernière socket se ferme. */
  disconnected(userId: string): boolean {
    const n = (this.online.get(userId) ?? 1) - 1;
    if (n <= 0) {
      this.online.delete(userId);
      return true;
    }
    this.online.set(userId, n);
    return false;
  }

  onlineIds(): string[] {
    return [...this.online.keys()];
  }

  isOnline(userId: string): boolean {
    return this.online.has(userId);
  }
}
