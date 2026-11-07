// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Assignment } from './assignment.entity';
import { AuditEntry, LoginAttempt } from './audit.entity';
import { Classroom, ClassroomMember } from './classroom.entity';
import { Conversation, ConversationRead, Message } from './conversation.entity';
import { StoredFile } from './file.entity';
import { Group, GroupMember } from './group.entity';
import { Notification } from './notification.entity';
import { ProjectVersion, SharedProject } from './project.entity';
import { RefreshToken } from './refresh-token.entity';
import { School } from './school.entity';
import { Submission } from './submission.entity';
import { User } from './user.entity';

export * from './assignment.entity';
export * from './audit.entity';
export * from './classroom.entity';
export * from './conversation.entity';
export * from './file.entity';
export * from './group.entity';
export * from './notification.entity';
export * from './project.entity';
export * from './refresh-token.entity';
export * from './school.entity';
export * from './submission.entity';
export * from './user.entity';

export const ENTITIES = [
  School, User, RefreshToken, Classroom, ClassroomMember, Assignment, Submission,
  Group, GroupMember, SharedProject, ProjectVersion, Conversation, Message, ConversationRead,
  StoredFile, Notification, AuditEntry, LoginAttempt,
];
