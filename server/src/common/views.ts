// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import type { Role, School, User } from '../database/entities';

export const publicRole = (role: Role): 'teacher' | 'student' => (role === 'student' ? 'student' : 'teacher');

export function userView(u: User) {
  return {
    id: u.id,
    schoolId: u.schoolId,
    role: u.role,
    displayName: u.displayName,
    username: u.username,
    email: u.email,
    avatarColor: u.avatarColor,
    mustChangePassword: u.mustChangePassword,
    lastSeenAt: u.lastSeenAt,
    createdAt: u.createdAt,
    disabled: u.disabled,
  };
}

export function schoolView(s: School) {
  return { id: s.id, name: s.name, plan: s.plan, trialEndsAt: s.trialEndsAt, createdAt: s.createdAt };
}

export function planActive(s: School, now = Date.now()): boolean {
  return s.plan === 'pro' || (s.plan === 'trial' && (!s.trialEndsAt || s.trialEndsAt.getTime() > now));
}
