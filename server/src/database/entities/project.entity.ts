// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Group } from './group.entity';
import { User } from './user.entity';

@Entity('shared_projects')
export class SharedProject {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) groupId: string;
  @ManyToOne(() => Group, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'group_id' }) group?: Group;
  @Column({ type: 'varchar', length: 120 }) title: string;
  @Column({ type: 'varchar', length: 2000, nullable: true }) description: string | null;
  // Pas de clé étrangère (référence circulaire avec les versions) : les versions partent avec le projet.
  @Column({ type: 'uuid', nullable: true }) currentVersionId: string | null;
  @Column({ type: 'uuid', nullable: true }) lockUserId: string | null;
  @ManyToOne(() => User, { onDelete: 'SET NULL' }) @JoinColumn({ name: 'lock_user_id' }) lockUser?: User;
  @Column({ type: 'timestamptz', nullable: true }) lockExpiresAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('project_versions')
@Index(['projectId', 'number'], { unique: true })
export class ProjectVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) projectId: string;
  @ManyToOne(() => SharedProject, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project?: SharedProject;
  @Column({ type: 'int' }) number: number;
  @Column({ type: 'uuid' }) authorId: string;
  @ManyToOne(() => User, { deferrable: 'INITIALLY DEFERRED' }) @JoinColumn({ name: 'author_id' }) author?: User;
  @Column({ type: 'varchar', length: 500, nullable: true }) message: string | null;
  @Column({ type: 'jsonb', select: false }) data: Record<string, unknown>;
  @Column({ type: 'int' }) size: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
