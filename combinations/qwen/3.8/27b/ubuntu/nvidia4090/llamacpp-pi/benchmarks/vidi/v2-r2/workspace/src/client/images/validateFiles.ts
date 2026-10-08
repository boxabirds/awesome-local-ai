/**
 * Client-side file validation for image insertion (story 12, image.insert).
 *
 * Validates files BEFORE any upload: type (by File.type), size (by File.size),
 * and count (max per action). Returns the accepted files and the set of
 * rejection types that occurred (for showing toasts).
 */

import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

/** A file was rejected for this reason. */
export type FileRejection = 'type' | 'size' | 'count';

/**
 * Exact PRD strings for each rejection type, plus the offline message.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** Result of validating a batch of files. */
export interface ValidationResult {
  /** Files that pass all checks and should be uploaded. */
  accepted: File[];
  /** Set of rejection types encountered (for showing toasts). */
  rejections: Set<FileRejection>;
}

/**
 * Validates an array of files for image insertion.
 *
 * Checks (in order):
 * 1. Type: File.type must be in IMAGE_ACCEPTED_TYPES
 * 2. Size: File.size must be <= IMAGE_MAX_BYTES
 * 3. Count: at most IMAGE_MAX_FILES_PER_ADD files total
 *
 * The first IMAGE_MAX_FILES_PER_ADD valid files are accepted; any excess
 * triggers a 'count' rejection.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  for (const file of files) {
    // Type check
    const type = file.type;
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type)) {
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

  // Count check: if more than the limit passed type+size, only take the first N
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
  }

  return { accepted, rejections };
}
