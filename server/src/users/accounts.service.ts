// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AVATAR_COLORS, pick } from '../common/colors';
import { AppError } from '../common/errors';
import { escapeRegex, firstFree, usernameBase } from '../common/usernames';
import { Role, User } from '../database/entities';

export interface NewAccount {
  displayName: string;
  role: Role;
  passwordHash: string;
  username?: string;
  email?: string | null;
  mustChangePassword?: boolean;
}

// Création de comptes : noms d'utilisateur uniques sur tout le serveur, attribués sous
// verrou consultatif pour que deux créations simultanées ne prennent pas le même nom.
@Injectable()
export class AccountsService {
  async create(manager: EntityManager, schoolId: string, accounts: NewAccount[]): Promise<User[]> {
    await manager.query('SELECT pg_advisory_xact_lock(727001)');

    const wanted = accounts.filter((a) => a.username).map((a) => a.username!);
    if (new Set(wanted).size !== wanted.length) throw new AppError(409, 'USERNAME_TAKEN', 'Duplicate username in request');
    if (wanted.length) {
      const taken: { username: string }[] = await manager.query('SELECT username FROM users WHERE username = ANY($1)', [wanted]);
      if (taken.length) {
        throw new AppError(409, 'USERNAME_TAKEN', `Username already taken: ${taken[0].username}`, { username: taken[0].username });
      }
    }
    const emails = accounts.filter((a) => a.email).map((a) => a.email!);
    if (emails.length) {
      const taken: unknown[] = await manager.query('SELECT 1 FROM users WHERE email = ANY($1)', [emails]);
      if (taken.length || new Set(emails).size !== emails.length) throw new AppError(409, 'EMAIL_TAKEN', 'Email already in use');
    }

    const bases = accounts.map((a) => (a.username ? null : usernameBase(a.displayName)));
    const unique = [...new Set(bases.filter((b): b is string => !!b))];
    const taken = new Set<string>(wanted);
    if (unique.length) {
      const re = `^(${unique.map(escapeRegex).join('|')})[0-9]*$`;
      const rows: { username: string }[] = await manager.query('SELECT username FROM users WHERE username ~ $1', [re]);
      rows.forEach((r) => taken.add(r.username));
    }

    const users = accounts.map((a, i) => {
      const username = a.username ?? firstFree(bases[i]!, taken);
      taken.add(username);
      return manager.create(User, {
        schoolId,
        role: a.role,
        displayName: a.displayName,
        username,
        email: a.email ?? null,
        passwordHash: a.passwordHash,
        avatarColor: pick(AVATAR_COLORS),
        mustChangePassword: a.mustChangePassword ?? false,
      });
    });
    return manager.save(users);
  }
}
