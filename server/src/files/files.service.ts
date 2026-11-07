// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';
import { Repository } from 'typeorm';
import type { Actor } from '../auth/actor';
import { AppError, err } from '../common/errors';
import { MB } from '../common/json';
import { FileRef, StoredFile } from '../database/entities';

export const FILE_MAX_BYTES = 10 * MB;

export function fileRef(f: Pick<StoredFile, 'id' | 'name' | 'mime' | 'size' | 'key'>): FileRef {
  return { id: f.id, name: f.name, mime: f.mime, size: f.size, url: `/api/v1/files/${f.id}/${f.key}` };
}

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.log', '.ino', '.c', '.h', '.cpp', '.hpp', '.py']);
export const JOLLOF_MIME = 'application/vnd.jollof+json';

// Seuls types jamais interprétés comme une page : ni HTML, ni SVG, ni JavaScript, ni XML.
export const INLINE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const STORED_MIMES = new Set([...INLINE_MIMES, 'application/pdf', 'text/plain', 'application/json', JOLLOF_MIME]);

/** En-têtes d'envoi d'un fichier : tout type hors liste (base modifiée à la main…) part en binaire à télécharger. */
export function servedType(mime: string): { contentType: string; inline: boolean } {
  if (!STORED_MIMES.has(mime)) return { contentType: 'application/octet-stream', inline: false };
  if (mime === 'text/plain') return { contentType: 'text/plain; charset=utf-8', inline: false };
  if (mime === 'application/json' || mime === JOLLOF_MIME) return { contentType: `${mime}; charset=utf-8`, inline: false };
  return { contentType: mime, inline: INLINE_MIMES.has(mime) };
}

// Le type vient du contenu (signatures), pas de ce que déclare le client : une page HTML
// déguisée en image ne passe pas.
function sniff(buf: Buffer): string | null {
  const head = (n: number) => buf.subarray(0, n);
  if (head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(head(6).toString('latin1'))) return 'image/gif';
  if (head(4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (head(5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

function isUtf8Text(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function cleanName(name: string): string {
  // multer lit le nom en latin1 : on le remet en UTF-8.
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  const base = (utf8.includes('\uFFFD') ? name : utf8).split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200) || 'file';
}

@Injectable()
export class FilesService {
  constructor(@InjectRepository(StoredFile) private readonly files: Repository<StoredFile>) {}

  detect(name: string, buf: Buffer): string {
    const sniffed = sniff(buf);
    if (sniffed) return sniffed;
    const ext = extname(name).toLowerCase();
    if (ext === '.json' || ext === '.jollof') {
      try {
        JSON.parse(buf.toString('utf8'));
      } catch {
        throw new AppError(415, 'FILE_TYPE', 'Invalid JSON file');
      }
      return ext === '.json' ? 'application/json' : JOLLOF_MIME;
    }
    if (TEXT_EXT.has(ext) && isUtf8Text(buf)) return 'text/plain';
    throw new AppError(415, 'FILE_TYPE', 'Allowed: png, jpeg, gif, webp, pdf, text, json, .jollof');
  }

  async upload(actor: Actor, file: Express.Multer.File | undefined) {
    if (!file) throw err.validation('file is required (multipart field "file")');
    if (file.size > FILE_MAX_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'Files are limited to 10 MB');
    if (file.size === 0) throw err.validation('Empty file');
    const name = cleanName(file.originalname);
    const mime = this.detect(name, file.buffer);
    if (!STORED_MIMES.has(mime)) throw new AppError(415, 'FILE_TYPE', 'File type not allowed');
    const saved = await this.files.save(
      this.files.create({ schoolId: actor.schoolId, ownerId: actor.id, name, mime, size: file.size, key: randomBytes(24).toString('base64url'), data: file.buffer }),
    );
    return fileRef(saved);
  }

  /** Fichier par sa clé ; le contenu (jusqu'à 10 Mo) n'est lu qu'une fois la clé vérifiée. */
  async fetch(id: string, key: string) {
    const f = await this.files.findOneBy({ id });
    const a = Buffer.from(key);
    const b = Buffer.from(f?.key ?? '');
    if (!f || a.length !== b.length || !timingSafeEqual(a, b)) throw err.notFound('File');
    const row = await this.files.createQueryBuilder('f').select('f.data', 'data').where('f.id = :id', { id }).getRawOne<{ data: Buffer }>();
    if (!row) throw err.notFound('File');
    return Object.assign(f, { data: row.data });
  }
}
