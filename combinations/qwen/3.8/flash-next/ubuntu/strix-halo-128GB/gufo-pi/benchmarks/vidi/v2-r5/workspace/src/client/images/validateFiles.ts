/**
 * Client-side file validation for image uploads.
 * Validates type, size, and count before any upload begins.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

const ACCEPTED_SET = new Set<string>(IMAGE_ACCEPTED_TYPES);

export interface ValidationResult {
  accepted: File[];
  rejections: Set<FileRejection>;
}

/**
 * Validate files: check MIME type and size. Keep only the first IMAGE_MAX_FILES_PER_ADD
 * accepted files; set 'count' rejection when more were valid but over the limit.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  for (const file of files) {
    // Type check
    if (!ACCEPTED_SET.has(file.type)) {
      rejections.add('type');
      continue;
    }
    // Size check
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }

  // Count check
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
  }

  return { accepted, rejections };
}
