/**
 * Client-side image file validation (story 12, image.insert).
 *
 * Rejects files before any upload:
 * - `type`: not a PNG/JPEG/GIF/WebP (judged by the File's MIME type);
 * - `size`: larger than IMAGE_MAX_BYTES;
 * - `count`: more than IMAGE_MAX_FILES_PER_ADD valid files in one action.
 *
 * Supported files from the same drop/paste/pick are still added even when
 * some files are rejected. `REJECTION_MESSAGES` hold the exact PRD strings.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/** Exact user-facing messages (PRD). */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

export interface ValidateResult {
  accepted: File[];
  rejections: Set<FileRejection>;
}

/**
 * Validate a batch of files. Returns the accepted files (at most
 * IMAGE_MAX_FILES_PER_ADD) and the set of rejection kinds that occurred.
 */
export function validateFiles(files: readonly File[]): ValidateResult {
  const rejections = new Set<FileRejection>();
  const valid: File[] = [];

  for (const file of files) {
    const typeOk = (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type);
    if (!typeOk) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    valid.push(file);
  }

  if (valid.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
  }

  const accepted = valid.slice(0, IMAGE_MAX_FILES_PER_ADD);
  return { accepted, rejections };
}
