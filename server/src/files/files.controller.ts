// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Actor, CurrentUser, Public } from '../auth/actor';
import { UUID } from '../common/validation';
import { FILE_MAX_BYTES, FilesService, servedType } from './files.service';

// Un fichier n'est jamais une page : aucun script, aucune ressource sauf ses propres images,
// et `sandbox` au cas où un navigateur l'afficherait quand même.
export const FILE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: FILE_MAX_BYTES, files: 1, fields: 5 } }))
  upload(@CurrentUser() actor: Actor, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.files.upload(actor, file);
  }

  // Public : la clé aléatoire de l'URL tient lieu d'autorisation (balises <img> du client).
  @Public()
  @Get(':id/:key')
  async get(@Param('id', UUID) id: string, @Param('key') key: string, @Res() res: Response) {
    const f = await this.files.fetch(id, key);
    const { contentType: type, inline } = servedType(f.mime);
    const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set({
      'Content-Type': type,
      'Content-Length': String(f.data.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      // Lisible depuis l'application (autre origine) ; jamais exécuté comme une page.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': FILE_CSP,
    });
    res.end(f.data);
  }
}
