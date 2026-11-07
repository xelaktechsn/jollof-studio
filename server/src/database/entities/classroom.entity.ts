// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { School } from './school.entity';
import { User } from './user.entity';

export interface ClassroomSettings {
  allowStudentGroups: boolean;
  maxGroupSize: number;
  allowStudentDirectMessages: boolean;
}

export const DEFAULT_CLASSROOM_SETTINGS: ClassroomSettings = {
  allowStudentGroups: true,
  maxGroupSize: 6,
  allowStudentDirectMessages: false,
};

@Entity('classrooms')
export class Classroom {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) schoolId: string;
  @ManyToOne(() => School, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'school_id' }) school?: School;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) subject: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) level: string | null;
  @Column({ type: 'varchar', length: 9 }) color: string;
  @Column({ type: 'boolean', default: false }) archived: boolean;
  @Column({ type: 'jsonb' }) settings: ClassroomSettings;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

export type ClassRole = 'teacher' | 'student';

@Entity('classroom_members')
export class ClassroomMember {
  @PrimaryColumn({ type: 'uuid' }) classroomId: string;
  @ManyToOne(() => Classroom, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'classroom_id' }) classroom?: Classroom;
  @Index() @PrimaryColumn({ type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user?: User;
  @Column({ type: 'varchar', length: 16 }) role: ClassRole;
  @CreateDateColumn({ type: 'timestamptz' }) joinedAt: Date;
}
