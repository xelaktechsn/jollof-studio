// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Assignment, Doc } from './assignment.entity';
import { User } from './user.entity';

export type SubmissionStatus = 'in_progress' | 'submitted' | 'graded' | 'returned';
export type Answer = { selected: string[] } | { doc: Doc };
export interface ItemScore {
  points: number | null;
  max: number;
  auto: boolean;
  comment: string | null;
  detail?: Record<string, unknown>;
}
export interface CircuitAnswer {
  nets: string[][];
  faults: number;
}

@Entity('submissions')
@Index(['assignmentId', 'studentId', 'attempt'], { unique: true })
// Une seule copie en cours par élève et par devoir, même sous requêtes concurrentes.
@Index('uq_submissions_in_progress', ['assignmentId', 'studentId'], { unique: true, where: `status = 'in_progress'` })
@Index(['status', 'deadlineAt'])
export class Submission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) assignmentId: string;
  @ManyToOne(() => Assignment, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'assignment_id' }) assignment?: Assignment;
  @Index() @Column({ type: 'uuid' }) studentId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'student_id' }) student?: User;
  @Column({ type: 'int' }) attempt: number;
  @Column({ type: 'varchar', length: 16, default: 'in_progress' }) status: SubmissionStatus;
  @Column({ type: 'jsonb', default: () => "'{}'" }) answers: Record<string, Answer>;
  @Column({ type: 'jsonb', nullable: true }) project: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) circuit: CircuitAnswer | null;
  @Column({ type: 'jsonb', default: () => "'{}'" }) itemScores: Record<string, ItemScore>;
  @Column({ type: 'double precision', nullable: true }) score: number | null;
  @Column({ type: 'double precision', default: 0 }) maxScore: number;
  @Column({ type: 'jsonb', nullable: true }) feedback: Doc | null;
  @Column({ type: 'boolean', default: false }) late: boolean;
  @Column({ type: 'timestamptz', nullable: true }) deadlineAt: Date | null;
  @Column({ type: 'timestamptz' }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) submittedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) gradedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) returnedAt: Date | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
