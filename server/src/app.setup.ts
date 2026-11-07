// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import compression from 'compression';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import type { ServerOptions } from 'socket.io';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { buildValidationPipe } from './common/validation';
import type { EnvConfig } from './config/env';

// Le client n'envoie que des indicateurs de frappe (et sa poignée de main avec le jeton) :
// 8 Ko suffisent largement, et une socket ne peut pas faire avaler un gros paquet au serveur.
export const SOCKET_MAX_BUFFER = 8 * 1024;

const allow = (origins: string[]) => (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) =>
  cb(null, !origin || origins.includes(origin));

/** Socket.IO avec la même liste d'origines que l'API HTTP. */
class AppIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      cors: { origin: allow(this.origins), credentials: false },
      maxHttpBufferSize: SOCKET_MAX_BUFFER,
    });
  }
}

/** Compression des seules réponses JSON d'au moins 1 Ko (les fichiers, images surtout, le sont déjà). */
export const compressJson = compression({
  threshold: 1024,
  filter: (req: Request, res: Response) => /^application\/json/i.test(String(res.getHeader('Content-Type') ?? '')) && compression.filter(req, res),
});

/** Réglages communs au serveur et aux tests e2e. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<EnvConfig, true>>(ConfigService);
  const origins = config.get('CORS_ORIGINS', { infer: true });
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy === true) {
    new Logger('Config').warn('TRUST_PROXY=true : la première adresse de X-Forwarded-For est crue, le client peut la falsifier. Préférer TRUST_PROXY=1 (un proxy).');
  }
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(compressJson);
  app.enableCors({
    origin: allow(origins),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Platform-Key'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  });
  // Projets Jollof jusqu'à 5 Mo, plus l'enveloppe JSON.
  app.useBodyParser('json', { limit: '6mb' });
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new AppIoAdapter(app, origins));
  app.enableShutdownHooks();
  return app;
}
