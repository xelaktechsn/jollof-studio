// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { School } from './school.entity';
import { User } from './user.entity';

@Entity('files')
export class StoredFile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'uuid' }) schoolId: string;
  @ManyToOne(() => School, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'school_id' }) school?: School;
  @Index() @Column({ type: 'uuid' }) ownerId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'owner_id' }) owner?: User;
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ type: 'varchar', length: 100 }) mime: string;
  @Column({ type: 'int' }) size: number;
  // Clé aléatoire de l'URL publique : le lien n'est pas devinable.
  @Column({ type: 'varchar', length: 64 }) key: string;
  @Column({ type: 'bytea', select: false }) data: Buffer;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
