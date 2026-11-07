// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssignmentsModule } from './assignments/assignments.module';
import { AuthModule } from './auth/auth.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { EnvConfig, validateEnv } from './config/env';
import { CoreModule } from './core.module';
import { typeOrmOptions } from './database/options';
import { FilesModule } from './files/files.module';
import { GroupsModule } from './groups/groups.module';
import { HealthController } from './health/health.controller';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Les tests fixent leur environnement eux-mêmes (base jollof_test).
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService<EnvConfig, true>) =>
        typeOrmOptions(c.get('DATABASE_URL', { infer: true }), c.get('DATABASE_SSL', { infer: true }), c.get('DB_POOL_SIZE', { infer: true })),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (c: ConfigService<EnvConfig, true>) => ({
        secret: c.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'jollof' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'jollof' },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService<EnvConfig, true>) => [{ name: 'default', ttl: 60_000, limit: c.get('LOGIN_RATE_LIMIT', { infer: true }) }],
    }),
    CoreModule,
    AuthModule,
    UsersModule,
    ClassroomsModule,
    AssignmentsModule,
    GroupsModule,
    ProjectsModule,
    MessagingModule,
    FilesModule,
    NotificationsModule,
    RealtimeModule,
    MaintenanceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
