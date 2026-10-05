/**
 * Client-side file validation for image uploads (story 12).
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export interface ValidationResult {
  accepted: File[];
  rejections: Set<FileRejection>;
}

const ACCEPTED_SET = new Set<string>(IMAGE_ACCEPTED_TYPES);

/**
 * Validate files for image upload: type, size and count.
 *
 * Returns the accepted files and a set of rejection reasons.
 * Rejected files are skipped; supported files from the same action are still added.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  for (const file of files) {
    // Check type
    if (!ACCEPTED_SET.has(file.type)) {
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

  // Check count
  let result = accepted;
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    result = accepted.slice(0, IMAGE_MAX_FILES_PER_ADD);
  }

  return { accepted: result, rejections };
}

/** Exact PRD wording for each rejection message. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline \u2014 images can be added when you reconnect.",
};
