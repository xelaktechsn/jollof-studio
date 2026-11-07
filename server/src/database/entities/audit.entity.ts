// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { School } from './school.entity';
import { User } from './user.entity';

export type AuditAction =
  | 'auth.login'
  | 'auth.locked'
  | 'school.created'
  | 'user.created'
  | 'user.password_reset'
  | 'user.password_changed'
  | 'user.disabled'
  | 'user.enabled'
  | 'classroom.archived'
  | 'classroom.unarchived'
  | 'assignment.published'
  | 'assignment.deleted'
  | 'project.lock_taken';

/**
 * Journal d'audit (lu par l'administrateur de l'école). Lignes courtes, purgées après 180 jours ;
 * les connexions sont résumées (une ligne par compte et par jour, avec les compteurs).
 */
@Entity('audit_log')
@Index(['schoolId', 'createdAt'])
@Index(['createdAt'])
export class AuditEntry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ type: 'uuid', nullable: true }) schoolId: string | null;
  @ManyToOne(() => School, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'school_id' }) school?: School;
  // Auteur de l'action (null : le système, ou une connexion à un compte inconnu).
  @Column({ type: 'uuid', nullable: true }) actorId: string | null;
  @ManyToOne(() => User, { onDelete: 'SET NULL' }) @JoinColumn({ name: 'actor_id' }) actor?: User;
  @Column({ type: 'varchar', length: 40 }) action: AuditAction;
  @Column({ type: 'varchar', length: 20, nullable: true }) targetType: string | null;
  @Column({ type: 'uuid', nullable: true }) targetId: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'" }) details: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz', precision: 3 }) createdAt: Date;
}

/**
 * Échecs de connexion par identifiant saisi (courriel ou nom d'utilisateur, en minuscules),
 * que le compte existe ou non : le comportement ne trahit pas l'existence d'un compte.
 */
@Entity('login_attempts')
export class LoginAttempt {
  @PrimaryColumn({ type: 'varchar', length: 254 }) login: string;
  @Column({ type: 'int', default: 0 }) failures: number;
  @Column({ type: 'timestamptz' }) lastFailureAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) blockedUntil: Date | null;
}
