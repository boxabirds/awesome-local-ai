// src/client/images/validateFiles.ts
// Client-side file validation: type, size, count checks.

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

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
 * Validates a list of files for image upload.
 * - Type: File.type must be in IMAGE_ACCEPTED_TYPES
 * - Size: file.size must be <= IMAGE_MAX_BYTES
 * - Count: at most IMAGE_MAX_FILES_PER_ADD files accepted
 *
 * Returns the accepted files and a set of rejection reasons.
 */
export function validateFiles(files: readonly File[]): ValidateResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  for (const file of files) {
    // Type check
    if (!IMAGE_ACCEPTED_TYPES.includes(file.type as any)) {
      rejections.add('type');
      continue;
    }

    // Size check
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }

    // Count check
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      rejections.add('count');
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejections };
}
