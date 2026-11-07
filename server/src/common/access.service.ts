// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Actor } from '../auth/actor';
import { Classroom, ClassroomMember, ClassRole, Group, GroupMember, GroupRole } from '../database/entities';
import { err } from './errors';
import { planActive } from './views';

// Contrôles d'accès partagés. Règle commune : ce qui appartient à une autre école
// n'existe pas (NOT_FOUND) ; dans l'école, un droit manquant donne FORBIDDEN.
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(Classroom) private readonly classrooms: Repository<Classroom>,
    @InjectRepository(ClassroomMember) private readonly members: Repository<ClassroomMember>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(GroupMember) private readonly groupMembers: Repository<GroupMember>,
  ) {}

  /** Actions enseignant : essai non échu ou forfait Pro. */
  requirePlan(actor: Actor) {
    if (!planActive(actor.school)) throw err.planRequired();
  }

  requireStaff(actor: Actor) {
    if (actor.role === 'student') throw err.forbidden('Teachers only');
  }

  async classRole(classroomId: string, userId: string): Promise<ClassRole | null> {
    const m = await this.members.findOneBy({ classroomId, userId });
    return m?.role ?? null;
  }

  async classroom(actor: Actor, id: string): Promise<{ classroom: Classroom; role: ClassRole }> {
    const classroom = await this.classrooms.findOneBy({ id });
    if (!classroom || classroom.schoolId !== actor.schoolId) throw err.notFound('Classroom');
    const role = await this.classRole(id, actor.id);
    if (!role) throw err.forbidden('Not a member of this classroom');
    return { classroom, role };
  }

  /** Enseignant de la classe ; `plan` : action d'écriture soumise au forfait. */
  async teacherClassroom(actor: Actor, id: string, plan = true): Promise<Classroom> {
    const { classroom, role } = await this.classroom(actor, id);
    if (role !== 'teacher') throw err.forbidden('Only teachers of this classroom can do this');
    if (plan) this.requirePlan(actor);
    return classroom;
  }

  /** Groupe visible : membre du groupe ou enseignant de sa classe. */
  async group(actor: Actor, id: string): Promise<{ group: Group; classroom: Classroom; classRole: ClassRole | null; groupRole: GroupRole | null }> {
    const group = await this.groups.findOneBy({ id });
    if (!group) throw err.notFound('Group');
    const classroom = await this.classrooms.findOneBy({ id: group.classroomId });
    if (!classroom || classroom.schoolId !== actor.schoolId) throw err.notFound('Group');
    const [classRole, gm] = await Promise.all([
      this.classRole(classroom.id, actor.id),
      this.groupMembers.findOneBy({ groupId: id, userId: actor.id }),
    ]);
    const groupRole = gm?.role ?? null;
    if (!groupRole && classRole !== 'teacher') throw err.forbidden('Not a member of this group');
    return { group, classroom, classRole, groupRole };
  }
}
