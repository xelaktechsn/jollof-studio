// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1793916551596 implements MigrationInterface {
    name = 'Init1793916551596'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "schools" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "name" character varying(120) NOT NULL,
                "plan" character varying(16) NOT NULL DEFAULT 'trial',
                "trial_ends_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_95b932e47ac129dd8e23a0db548" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "school_id" uuid NOT NULL,
                "role" character varying(16) NOT NULL,
                "display_name" character varying(100) NOT NULL,
                "username" character varying(64) NOT NULL,
                "email" character varying(254),
                "password_hash" character varying(100) NOT NULL,
                "avatar_color" character varying(9) NOT NULL,
                "must_change_password" boolean NOT NULL DEFAULT false,
                "disabled" boolean NOT NULL DEFAULT false,
                "last_seen_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_fe0bb3f6520ee0469504521e71" ON "users" ("username")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_c4d163fc1bbd1afdcdece98251" ON "users" ("school_id", "role")
        `);
        await queryRunner.query(`
            CREATE TABLE "classrooms" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "school_id" uuid NOT NULL,
                "name" character varying(120) NOT NULL,
                "subject" character varying(120),
                "level" character varying(60),
                "color" character varying(9) NOT NULL,
                "archived" boolean NOT NULL DEFAULT false,
                "settings" jsonb NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_20b7b82896c06eda27548bd0c24" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_e646169186c787163efbef45f9" ON "classrooms" ("school_id")
        `);
        await queryRunner.query(`
            CREATE TABLE "classroom_members" (
                "classroom_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "role" character varying(16) NOT NULL,
                "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_261e092a9d89008e50644a0607f" PRIMARY KEY ("classroom_id", "user_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_2421677630302069fea29b7abc" ON "classroom_members" ("user_id")
        `);
        await queryRunner.query(`
            CREATE TABLE "assignments" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "classroom_id" uuid NOT NULL,
                "author_id" uuid NOT NULL,
                "kind" character varying(16) NOT NULL,
                "title" character varying(200) NOT NULL,
                "instructions" jsonb,
                "items" jsonb NOT NULL DEFAULT '[]',
                "starter_project" jsonb,
                "settings" jsonb NOT NULL,
                "status" character varying(16) NOT NULL DEFAULT 'draft',
                "audience" jsonb NOT NULL DEFAULT '{"all":true}',
                "due_at" TIMESTAMP WITH TIME ZONE,
                "published_at" TIMESTAMP WITH TIME ZONE,
                "total_points" double precision NOT NULL DEFAULT '0',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_c54ca359535e0012b04dcbd80ee" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_20235d168e0ca80d787f92f0fd" ON "assignments" ("classroom_id", "status")
        `);
        await queryRunner.query(`
            CREATE TABLE "groups" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "classroom_id" uuid NOT NULL,
                "name" character varying(80) NOT NULL,
                "color" character varying(9) NOT NULL,
                "created_by" uuid NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_659d1483316afb28afd3a90646e" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_4bf02a3f06f173a4e56cae8543" ON "groups" ("classroom_id")
        `);
        await queryRunner.query(`
            CREATE TABLE "group_members" (
                "group_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "role" character varying(16) NOT NULL DEFAULT 'member',
                "joined_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_f5939ee0ad233ad35e03f5c65c1" PRIMARY KEY ("group_id", "user_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_20a555b299f75843aa53ff8b0e" ON "group_members" ("user_id")
        `);
        await queryRunner.query(`
            CREATE TABLE "conversations" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "school_id" uuid NOT NULL,
                "kind" character varying(16) NOT NULL,
                "classroom_id" uuid,
                "group_id" uuid,
                "user_a_id" uuid,
                "user_b_id" uuid,
                "settings" jsonb NOT NULL DEFAULT '{"studentsCanPost":true}',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_f40f076368ec7104e2e943326f" ON "conversations" ("school_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_631d31d45e8f9b900e8bf913f0" ON "conversations" ("user_a_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_ce35954d8c3216fcf888337b04" ON "conversations" ("user_b_id")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_conversations_direct" ON "conversations" ("user_a_id", "user_b_id")
            WHERE kind = 'direct'
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_conversations_group" ON "conversations" ("group_id")
            WHERE kind = 'group'
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_conversations_class" ON "conversations" ("classroom_id")
            WHERE kind = 'class'
        `);
        await queryRunner.query(`
            CREATE TABLE "messages" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "seq" BIGSERIAL NOT NULL,
                "conversation_id" uuid NOT NULL,
                "sender_id" uuid NOT NULL,
                "body" text,
                "attachments" jsonb NOT NULL DEFAULT '[]',
                "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
                "edited_at" TIMESTAMP WITH TIME ZONE,
                "deleted" boolean NOT NULL DEFAULT false,
                CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_22133395bd13b970ccd0c34ab2" ON "messages" ("sender_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_6c6ea2ab4c0804750cd95eefa8" ON "messages" ("conversation_id", "seq")
        `);
        await queryRunner.query(`
            CREATE TABLE "conversation_reads" (
                "conversation_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "last_read_seq" bigint NOT NULL DEFAULT '0',
                CONSTRAINT "PK_05074524cfb8e1d6fad9fb51a90" PRIMARY KEY ("conversation_id", "user_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_624a8ae9effca740379bff2bcd" ON "conversation_reads" ("user_id")
        `);
        await queryRunner.query(`
            CREATE TABLE "files" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "school_id" uuid NOT NULL,
                "owner_id" uuid NOT NULL,
                "name" character varying(255) NOT NULL,
                "mime" character varying(100) NOT NULL,
                "size" integer NOT NULL,
                "key" character varying(64) NOT NULL,
                "data" bytea NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_368aa8317b082939527b8b88ef" ON "files" ("school_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_4bc1db1f4f34ec9415acd88afd" ON "files" ("owner_id")
        `);
        await queryRunner.query(`
            CREATE TABLE "notifications" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "user_id" uuid NOT NULL,
                "type" character varying(40) NOT NULL,
                "data" jsonb NOT NULL DEFAULT '{}',
                "read_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_310667f935698fcd8cb319113a" ON "notifications" ("user_id", "created_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "shared_projects" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "group_id" uuid NOT NULL,
                "title" character varying(120) NOT NULL,
                "description" character varying(2000),
                "current_version_id" uuid,
                "lock_user_id" uuid,
                "lock_expires_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_cc6569a28c0f14e74eaba63f753" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_1e7561e4a794bf01d5269c1e53" ON "shared_projects" ("group_id")
        `);
        await queryRunner.query(`
            CREATE TABLE "project_versions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "project_id" uuid NOT NULL,
                "number" integer NOT NULL,
                "author_id" uuid NOT NULL,
                "message" character varying(500),
                "data" jsonb NOT NULL,
                "size" integer NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_0933adf663634f5c8c335e7b5e4" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_8c002f55522cc095f250ac57ec" ON "project_versions" ("project_id", "number")
        `);
        await queryRunner.query(`
            CREATE TABLE "refresh_tokens" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "user_id" uuid NOT NULL,
                "family_id" uuid NOT NULL,
                "token_hash" character(64) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "revoked_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_3ddc983c5f7bcf132fd8732c3f" ON "refresh_tokens" ("user_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_d5e27da0cd39bc3bb2811fc8ba" ON "refresh_tokens" ("family_id")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_a7838d2ba25be1342091b6695f" ON "refresh_tokens" ("token_hash")
        `);
        await queryRunner.query(`
            CREATE TABLE "submissions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "assignment_id" uuid NOT NULL,
                "student_id" uuid NOT NULL,
                "attempt" integer NOT NULL,
                "status" character varying(16) NOT NULL DEFAULT 'in_progress',
                "answers" jsonb NOT NULL DEFAULT '{}',
                "project" jsonb,
                "circuit" jsonb,
                "item_scores" jsonb NOT NULL DEFAULT '{}',
                "score" double precision,
                "max_score" double precision NOT NULL DEFAULT '0',
                "feedback" jsonb,
                "late" boolean NOT NULL DEFAULT false,
                "deadline_at" TIMESTAMP WITH TIME ZONE,
                "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "submitted_at" TIMESTAMP WITH TIME ZONE,
                "graded_at" TIMESTAMP WITH TIME ZONE,
                "returned_at" TIMESTAMP WITH TIME ZONE,
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_10b3be95b8b2fb1e482e07d706b" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_435def3bbd4b4bbb9de1209cda" ON "submissions" ("student_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_0225963817a02abcbd24718cdf" ON "submissions" ("status", "deadline_at")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "uq_submissions_in_progress" ON "submissions" ("assignment_id", "student_id")
            WHERE status = 'in_progress'
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_daa1ef78ea1c96950b21be6bb8" ON "submissions" ("assignment_id", "student_id", "attempt")
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD CONSTRAINT "FK_25e1cf8f41bae2f3d11f3c2a028" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "classrooms"
            ADD CONSTRAINT "FK_e646169186c787163efbef45f99" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "classroom_members"
            ADD CONSTRAINT "FK_44dce22b6af24d8bbcd339d967c" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "classroom_members"
            ADD CONSTRAINT "FK_2421677630302069fea29b7abc5" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD CONSTRAINT "FK_86e7005d670a6ae7eaae7e0fdbd" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD CONSTRAINT "FK_f3348bc69d8f40e5be97728503a" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED
        `);
        await queryRunner.query(`
            ALTER TABLE "groups"
            ADD CONSTRAINT "FK_4bf02a3f06f173a4e56cae8543d" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "groups"
            ADD CONSTRAINT "FK_a2fa29bfd5351b5b7ccacbc9f7c" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED
        `);
        await queryRunner.query(`
            ALTER TABLE "group_members"
            ADD CONSTRAINT "FK_2c840df5db52dc6b4a1b0b69c6e" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "group_members"
            ADD CONSTRAINT "FK_20a555b299f75843aa53ff8b0ee" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD CONSTRAINT "FK_f40f076368ec7104e2e943326fb" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD CONSTRAINT "FK_cb788c5088e9025802077a00a79" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD CONSTRAINT "FK_13a9c2d1dc1f6959e48fe5a7c93" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD CONSTRAINT "FK_631d31d45e8f9b900e8bf913f08" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD CONSTRAINT "FK_ce35954d8c3216fcf888337b046" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_22133395bd13b970ccd0c34ab22" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "conversation_reads"
            ADD CONSTRAINT "FK_25d515c61b895dc8d16c4a74ca0" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "conversation_reads"
            ADD CONSTRAINT "FK_624a8ae9effca740379bff2bcd6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "files"
            ADD CONSTRAINT "FK_368aa8317b082939527b8b88ef0" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "files"
            ADD CONSTRAINT "FK_4bc1db1f4f34ec9415acd88afdb" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "notifications"
            ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "shared_projects"
            ADD CONSTRAINT "FK_1e7561e4a794bf01d5269c1e53c" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "shared_projects"
            ADD CONSTRAINT "FK_8cad12b1ce238961ceb8a8f2388" FOREIGN KEY ("lock_user_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "project_versions"
            ADD CONSTRAINT "FK_f1deab56bfe3bd92fe174118519" FOREIGN KEY ("project_id") REFERENCES "shared_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "project_versions"
            ADD CONSTRAINT "FK_a7b4d5969b4f1b36578931bfec4" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED
        `);
        await queryRunner.query(`
            ALTER TABLE "refresh_tokens"
            ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "submissions"
            ADD CONSTRAINT "FK_8723840b9b0464206640c268abc" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "submissions"
            ADD CONSTRAINT "FK_435def3bbd4b4bbb9de1209cdae" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "submissions" DROP CONSTRAINT "FK_435def3bbd4b4bbb9de1209cdae"
        `);
        await queryRunner.query(`
            ALTER TABLE "submissions" DROP CONSTRAINT "FK_8723840b9b0464206640c268abc"
        `);
        await queryRunner.query(`
            ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"
        `);
        await queryRunner.query(`
            ALTER TABLE "project_versions" DROP CONSTRAINT "FK_a7b4d5969b4f1b36578931bfec4"
        `);
        await queryRunner.query(`
            ALTER TABLE "project_versions" DROP CONSTRAINT "FK_f1deab56bfe3bd92fe174118519"
        `);
        await queryRunner.query(`
            ALTER TABLE "shared_projects" DROP CONSTRAINT "FK_8cad12b1ce238961ceb8a8f2388"
        `);
        await queryRunner.query(`
            ALTER TABLE "shared_projects" DROP CONSTRAINT "FK_1e7561e4a794bf01d5269c1e53c"
        `);
        await queryRunner.query(`
            ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"
        `);
        await queryRunner.query(`
            ALTER TABLE "files" DROP CONSTRAINT "FK_4bc1db1f4f34ec9415acd88afdb"
        `);
        await queryRunner.query(`
            ALTER TABLE "files" DROP CONSTRAINT "FK_368aa8317b082939527b8b88ef0"
        `);
        await queryRunner.query(`
            ALTER TABLE "conversation_reads" DROP CONSTRAINT "FK_624a8ae9effca740379bff2bcd6"
        `);
        await queryRunner.query(`
            ALTER TABLE "conversation_reads" DROP CONSTRAINT "FK_25d515c61b895dc8d16c4a74ca0"
        `);
        await queryRunner.query(`
            ALTER TABLE "messages" DROP CONSTRAINT "FK_22133395bd13b970ccd0c34ab22"
        `);
        await queryRunner.query(`
            ALTER TABLE "messages" DROP CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23"
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations" DROP CONSTRAINT "FK_ce35954d8c3216fcf888337b046"
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations" DROP CONSTRAINT "FK_631d31d45e8f9b900e8bf913f08"
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations" DROP CONSTRAINT "FK_13a9c2d1dc1f6959e48fe5a7c93"
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations" DROP CONSTRAINT "FK_cb788c5088e9025802077a00a79"
        `);
        await queryRunner.query(`
            ALTER TABLE "conversations" DROP CONSTRAINT "FK_f40f076368ec7104e2e943326fb"
        `);
        await queryRunner.query(`
            ALTER TABLE "group_members" DROP CONSTRAINT "FK_20a555b299f75843aa53ff8b0ee"
        `);
        await queryRunner.query(`
            ALTER TABLE "group_members" DROP CONSTRAINT "FK_2c840df5db52dc6b4a1b0b69c6e"
        `);
        await queryRunner.query(`
            ALTER TABLE "groups" DROP CONSTRAINT "FK_a2fa29bfd5351b5b7ccacbc9f7c"
        `);
        await queryRunner.query(`
            ALTER TABLE "groups" DROP CONSTRAINT "FK_4bf02a3f06f173a4e56cae8543d"
        `);
        await queryRunner.query(`
            ALTER TABLE "assignments" DROP CONSTRAINT "FK_f3348bc69d8f40e5be97728503a"
        `);
        await queryRunner.query(`
            ALTER TABLE "assignments" DROP CONSTRAINT "FK_86e7005d670a6ae7eaae7e0fdbd"
        `);
        await queryRunner.query(`
            ALTER TABLE "classroom_members" DROP CONSTRAINT "FK_2421677630302069fea29b7abc5"
        `);
        await queryRunner.query(`
            ALTER TABLE "classroom_members" DROP CONSTRAINT "FK_44dce22b6af24d8bbcd339d967c"
        `);
        await queryRunner.query(`
            ALTER TABLE "classrooms" DROP CONSTRAINT "FK_e646169186c787163efbef45f99"
        `);
        await queryRunner.query(`
            ALTER TABLE "users" DROP CONSTRAINT "FK_25e1cf8f41bae2f3d11f3c2a028"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_daa1ef78ea1c96950b21be6bb8"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."uq_submissions_in_progress"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_0225963817a02abcbd24718cdf"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_435def3bbd4b4bbb9de1209cda"
        `);
        await queryRunner.query(`
            DROP TABLE "submissions"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_a7838d2ba25be1342091b6695f"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_d5e27da0cd39bc3bb2811fc8ba"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_3ddc983c5f7bcf132fd8732c3f"
        `);
        await queryRunner.query(`
            DROP TABLE "refresh_tokens"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_8c002f55522cc095f250ac57ec"
        `);
        await queryRunner.query(`
            DROP TABLE "project_versions"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_1e7561e4a794bf01d5269c1e53"
        `);
        await queryRunner.query(`
            DROP TABLE "shared_projects"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_310667f935698fcd8cb319113a"
        `);
        await queryRunner.query(`
            DROP TABLE "notifications"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_4bc1db1f4f34ec9415acd88afd"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_368aa8317b082939527b8b88ef"
        `);
        await queryRunner.query(`
            DROP TABLE "files"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_624a8ae9effca740379bff2bcd"
        `);
        await queryRunner.query(`
            DROP TABLE "conversation_reads"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_6c6ea2ab4c0804750cd95eefa8"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_22133395bd13b970ccd0c34ab2"
        `);
        await queryRunner.query(`
            DROP TABLE "messages"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."uq_conversations_class"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."uq_conversations_group"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."uq_conversations_direct"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_ce35954d8c3216fcf888337b04"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_631d31d45e8f9b900e8bf913f0"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_f40f076368ec7104e2e943326f"
        `);
        await queryRunner.query(`
            DROP TABLE "conversations"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_20a555b299f75843aa53ff8b0e"
        `);
        await queryRunner.query(`
            DROP TABLE "group_members"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_4bf02a3f06f173a4e56cae8543"
        `);
        await queryRunner.query(`
            DROP TABLE "groups"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_20235d168e0ca80d787f92f0fd"
        `);
        await queryRunner.query(`
            DROP TABLE "assignments"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_2421677630302069fea29b7abc"
        `);
        await queryRunner.query(`
            DROP TABLE "classroom_members"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_e646169186c787163efbef45f9"
        `);
        await queryRunner.query(`
            DROP TABLE "classrooms"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_c4d163fc1bbd1afdcdece98251"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_fe0bb3f6520ee0469504521e71"
        `);
        await queryRunner.query(`
            DROP TABLE "users"
        `);
        await queryRunner.query(`
            DROP TABLE "schools"
        `);
    }

}
