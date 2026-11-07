// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Plan = 'trial' | 'pro' | 'expired';

@Entity('schools')
export class School {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'varchar', length: 16, default: 'trial' }) plan: Plan;
  @Column({ type: 'timestamptz', nullable: true }) trialEndsAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
