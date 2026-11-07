// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { Classroom } from './classroom.entity';
import { User } from './user.entity';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) classroomId: string;
  @ManyToOne(() => Classroom, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'classroom_id' }) classroom?: Classroom;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ type: 'varchar', length: 9 }) color: string;
  @Column({ type: 'uuid' }) createdBy: string;
  @ManyToOne(() => User, { deferrable: 'INITIALLY DEFERRED' }) @JoinColumn({ name: 'created_by' }) creator?: User;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export type GroupRole = 'owner' | 'member';

@Entity('group_members')
export class GroupMember {
  @PrimaryColumn({ type: 'uuid' }) groupId: string;
  @ManyToOne(() => Group, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'group_id' }) group?: Group;
  @Index() @PrimaryColumn({ type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user?: User;
  @Column({ type: 'varchar', length: 16, default: 'member' }) role: GroupRole;
  // Précision à la milliseconde : « le plus ancien » doit départager deux ajouts proches.
  @CreateDateColumn({ type: 'timestamptz', precision: 3 }) joinedAt: Date;
}
