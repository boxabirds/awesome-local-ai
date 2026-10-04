/**
 * Client-side file validation for image uploads (story 12).
 * Pure function, no DOM imports (File is a web standard interface).
 */
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
 * Validate a set of files for image upload.
 * - Type: File.type must be in IMAGE_ACCEPTED_TYPES
 * - Size: file.size must be <= IMAGE_MAX_BYTES
 * - Count: at most IMAGE_MAX_FILES_PER_ADD files are accepted
 *
 * Returns the accepted files (in order) and the set of rejection reasons.
 */
export function validateFiles(files: readonly File[]): ValidateResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  for (const file of files) {
    // Type check
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
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
