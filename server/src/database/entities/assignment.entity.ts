// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Classroom } from './classroom.entity';
import { User } from './user.entity';

export type Doc = Record<string, unknown>;

export type Item =
  | { id: string; type: 'text'; content: Doc }
  | { id: string; type: 'choice'; prompt: Doc; options: { id: string; text: string }[]; multiple: boolean; correct: string[]; points: number }
  | { id: string; type: 'open'; prompt: Doc; points: number; rubric: Doc | null }
  | { id: string; type: 'circuit'; prompt: Doc; points: number; solution: { nets: string[][] }; requireNoFaults: boolean };

export type ShowResults = 'immediately' | 'after_return' | 'never';

export interface AssignmentSettings {
  maxAttempts: number;
  showResults: ShowResults;
  timeLimitMinutes: number | null;
  allowLate: boolean;
  faultPenalty: number;
}

export type Audience = { all: true } | { all: false; userIds: string[] };
export type AssignmentStatus = 'draft' | 'published' | 'closed';

@Entity('assignments')
@Index(['classroomId', 'status'])
export class Assignment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) classroomId: string;
  @ManyToOne(() => Classroom, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'classroom_id' }) classroom?: Classroom;
  @Column({ type: 'uuid' }) authorId: string;
  // Contrôle différé : la suppression d'une école (cascade) passe, celle d'un seul auteur non.
  @ManyToOne(() => User, { deferrable: 'INITIALLY DEFERRED' }) @JoinColumn({ name: 'author_id' }) author?: User;
  @Column({ type: 'varchar', length: 16 }) kind: 'exercise' | 'evaluation';
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'jsonb', nullable: true }) instructions: Doc | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) items: Item[];
  @Column({ type: 'jsonb', nullable: true }) starterProject: Record<string, unknown> | null;
  @Column({ type: 'jsonb' }) settings: AssignmentSettings;
  @Column({ type: 'varchar', length: 16, default: 'draft' }) status: AssignmentStatus;
  @Column({ type: 'jsonb', default: () => `'{"all":true}'` }) audience: Audience;
  @Column({ type: 'timestamptz', nullable: true }) dueAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) publishedAt: Date | null;
  @Column({ type: 'double precision', default: 0 }) totalPoints: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
