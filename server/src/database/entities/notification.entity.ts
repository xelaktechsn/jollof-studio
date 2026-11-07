// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

export type NotificationType =
  | 'assignment_published'
  | 'submission_received'
  | 'submission_graded'
  | 'submission_returned'
  | 'group_added'
  | 'project_lock_taken';

@Entity('notifications')
@Index(['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user?: User;
  @Column({ type: 'varchar', length: 40 }) type: NotificationType;
  @Column({ type: 'jsonb', default: () => "'{}'" }) data: Record<string, unknown>;
  @Column({ type: 'timestamptz', nullable: true }) readAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz', precision: 3 }) createdAt: Date;
}
