// Client-side file validation for image uploads.
// Story 12.

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Validate a list of files for image upload.
 * - Type: File.type must be in IMAGE_ACCEPTED_TYPES
 * - Size: File.size must be <= IMAGE_MAX_BYTES
 * - Count: at most IMAGE_MAX_FILES_PER_ADD accepted files
 *
 * Returns the accepted files (up to the count limit) and a set of rejection reasons.
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  for (const file of files) {
    // Type check
    if (!IMAGE_ACCEPTED_TYPES.includes(file.type as typeof IMAGE_ACCEPTED_TYPES[number])) {
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

  // Count limit
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    return { accepted: accepted.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
  }

  return { accepted, rejections };
}
