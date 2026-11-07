// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { MigrationInterface, QueryRunner } from "typeorm";

// Durcissement : version des jetons d'accès (révocation immédiate), compteurs d'échecs de
// connexion par identifiant, journal d'audit de l'école.

export class Hardening1793921208866 implements MigrationInterface {
    name = 'Hardening1793921208866'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "audit_log" (
                "id" BIGSERIAL NOT NULL,
                "school_id" uuid,
                "actor_id" uuid,
                "action" character varying(40) NOT NULL,
                "target_type" character varying(20),
                "target_id" uuid,
                "details" jsonb NOT NULL DEFAULT '{}',
                "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_07fefa57f7f5ab8fc3f52b3ed0b" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_2ad7930a7c2af80585c8c1b770" ON "audit_log" ("created_at")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_ab8d0f933931ccef852eb8158c" ON "audit_log" ("school_id", "created_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "login_attempts" (
                "login" character varying(254) NOT NULL,
                "failures" integer NOT NULL DEFAULT '0',
                "last_failure_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "blocked_until" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_dd59e599ccd9ba85e7e5a2963d1" PRIMARY KEY ("login")
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD "token_version" integer NOT NULL DEFAULT '0'
        `);
        await queryRunner.query(`
            ALTER TABLE "audit_log"
            ADD CONSTRAINT "FK_6d3284fadc70d7d2a0430fe3655" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "audit_log"
            ADD CONSTRAINT "FK_15a6f5aad57db494c17986ed2e2" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "audit_log" DROP CONSTRAINT "FK_15a6f5aad57db494c17986ed2e2"
        `);
        await queryRunner.query(`
            ALTER TABLE "audit_log" DROP CONSTRAINT "FK_6d3284fadc70d7d2a0430fe3655"
        `);
        await queryRunner.query(`
            ALTER TABLE "users" DROP COLUMN "token_version"
        `);
        await queryRunner.query(`
            DROP TABLE "login_attempts"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_ab8d0f933931ccef852eb8158c"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_2ad7930a7c2af80585c8c1b770"
        `);
        await queryRunner.query(`
            DROP TABLE "audit_log"
        `);
    }

}
