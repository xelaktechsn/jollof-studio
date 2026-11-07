// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Generated, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Classroom } from './classroom.entity';
import { Group } from './group.entity';
import { School } from './school.entity';
import { User } from './user.entity';

export type ConversationKind = 'class' | 'group' | 'direct';

export interface FileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

@Entity('conversations')
@Index('uq_conversations_class', ['classroomId'], { unique: true, where: `kind = 'class'` })
@Index('uq_conversations_group', ['groupId'], { unique: true, where: `kind = 'group'` })
// Message direct : une seule conversation par paire (userAId < userBId).
@Index('uq_conversations_direct', ['userAId', 'userBId'], { unique: true, where: `kind = 'direct'` })
export class Conversation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) schoolId: string;
  @ManyToOne(() => School, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'school_id' }) school?: School;
  @Column({ type: 'varchar', length: 16 }) kind: ConversationKind;
  @Column({ type: 'uuid', nullable: true }) classroomId: string | null;
  @ManyToOne(() => Classroom, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'classroom_id' }) classroom?: Classroom;
  @Column({ type: 'uuid', nullable: true }) groupId: string | null;
  @ManyToOne(() => Group, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'group_id' }) group?: Group;
  @Index() @Column({ type: 'uuid', nullable: true }) userAId: string | null;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_a_id' }) userA?: User;
  @Index() @Column({ type: 'uuid', nullable: true }) userBId: string | null;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_b_id' }) userB?: User;
  @Column({ type: 'jsonb', default: () => `'{"studentsCanPost":true}'` }) settings: { studentsCanPost: boolean };
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  // Dernière activité (dernier message) : tri de la liste des conversations.
  @UpdateDateColumn({ type: 'timestamptz', precision: 3 }) updatedAt: Date;
}

@Entity('messages')
@Index(['conversationId', 'seq'])
export class Message {
  @PrimaryGeneratedColumn('uuid') id: string;
  // Ordre d'arrivée strict : pagination et compteurs de non-lus sans ambiguïté d'horodatage.
  @Column({ type: 'bigint' }) @Generated('increment') seq: string;
  @Column({ type: 'uuid' }) conversationId: string;
  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'conversation_id' }) conversation?: Conversation;
  @Index() @Column({ type: 'uuid' }) senderId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'sender_id' }) sender?: User;
  @Column({ type: 'text', nullable: true }) body: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) attachments: FileRef[];
  @CreateDateColumn({ type: 'timestamptz', precision: 3 }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) editedAt: Date | null;
  @Column({ type: 'boolean', default: false }) deleted: boolean;
}

/** Position de lecture d'un membre : dernier message lu (seq). */
@Entity('conversation_reads')
export class ConversationRead {
  @PrimaryColumn({ type: 'uuid' }) conversationId: string;
  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'conversation_id' }) conversation?: Conversation;
  @Index() @PrimaryColumn({ type: 'uuid' }) userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user?: User;
  @Column({ type: 'bigint', default: 0 }) lastReadSeq: string;
}
