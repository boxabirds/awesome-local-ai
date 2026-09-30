/**
 * Client-side file validation for image uploads (story 12).
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Validate files for upload. Returns accepted files and the set of rejection reasons.
 * Accepted types are judged by File.type (MIME). Size limit is IMAGE_MAX_BYTES.
 * Count limit is IMAGE_MAX_FILES_PER_ADD.
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();

  for (const file of files) {
    // Check type
    if (!IMAGE_ACCEPTED_TYPES.includes(file.type as any)) {
      rejections.add('type');
      continue;
    }
    // Check size
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }

  // Check count limit
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
  }

  return { accepted, rejections };
}
