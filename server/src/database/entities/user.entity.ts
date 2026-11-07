// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { School } from './school.entity';

export type Role = 'admin' | 'teacher' | 'student';

@Entity('users')
@Index(['schoolId', 'role'])
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) schoolId: string;
  @ManyToOne(() => School, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'school_id' }) school?: School;
  @Column({ type: 'varchar', length: 16 }) role: Role;
  @Column({ type: 'varchar', length: 100 }) displayName: string;
  // Unique sur tout le serveur : la connexion ne précise pas l'école. Toujours en minuscules.
  @Index({ unique: true }) @Column({ type: 'varchar', length: 64 }) username: string;
  @Index({ unique: true }) @Column({ type: 'varchar', length: 254, nullable: true }) email: string | null;
  @Column({ type: 'varchar', length: 100, select: false }) passwordHash: string;
  @Column({ type: 'varchar', length: 9 }) avatarColor: string;
  @Column({ type: 'boolean', default: false }) mustChangePassword: boolean;
  @Column({ type: 'boolean', default: false }) disabled: boolean;
  // Version des jetons d'accès : l'augmenter (mot de passe changé, compte désactivé…) invalide
  // aussitôt tous les jetons déjà émis, sans attendre leur expiration.
  @Column({ type: 'int', default: 0 }) tokenVersion: number;
  @Column({ type: 'timestamptz', nullable: true }) lastSeenAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
