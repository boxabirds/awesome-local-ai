/**
 * Client-side file validation before upload.
 *
 * Checks type, size and count so the user gets immediate feedback rather than
 * a server rejection after waiting. Accepted types are judged by File.type (MIME).
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export interface ValidationResult {
  accepted: File[];
  rejections: Set<FileRejection>;
}

const ACCEPTED_SET: Set<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

/** Validate a batch of files: type, size, count limits. */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();
  const typeAndSizeOk: File[] = [];

  for (const file of files) {
    // Type check: must be one of the accepted MIME types.
    if (!ACCEPTED_SET.has(file.type)) {
      rejections.add('type');
      continue;
    }
    // Size check: must be at most IMAGE_MAX_BYTES.
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    typeAndSizeOk.push(file);
  }

  // Count check: at most IMAGE_MAX_FILES_PER_ADD.
  let accepted: File[];
  if (typeAndSizeOk.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted = typeAndSizeOk.slice(0, IMAGE_MAX_FILES_PER_ADD);
  } else {
    accepted = typeAndSizeOk;
  }

  return { accepted, rejections };
}

/** The exact PRD messages shown in a toast for each rejection reason. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You\u2019re offline \u2014 images can be added when you reconnect."
};
