/**
 * Client-side file validation (story 12, image.insert).
 *
 * `validateFiles` applies the count, type and size rules to an array of
 * File objects and returns the accepted files plus the set of rejection
 * reasons. The rules are applied in order:
 *  1. Count: keep the first IMAGE_MAX_FILES_PER_ADD (reject 'count' if more)
 *  2. Type: reject files whose File.type is not in IMAGE_ACCEPTED_TYPES
 *  3. Size: reject files larger than IMAGE_MAX_BYTES
 *
 * `REJECTION_MESSAGES` holds the exact PRD toast strings.
 */

import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

export interface ValidationResult {
  accepted: File[];
  rejections: Set<FileRejection>;
}

function isAcceptedType(fileType: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(fileType);
}

/**
 * Validate an array of files for image insertion.
 *
 * - If more than IMAGE_MAX_FILES_PER_ADD files are passed, only the first
 *   IMAGE_MAX_FILES_PER_ADD are considered and 'count' is added to rejections.
 * - Files whose type is not in IMAGE_ACCEPTED_TYPES are rejected ('type').
 * - Files larger than IMAGE_MAX_BYTES are rejected ('size').
 *
 * The accepted array contains only files that pass all checks.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();

  // Count check: if more than IMAGE_MAX_FILES_PER_ADD, truncate and flag.
  let candidates: readonly File[] = files;
  if (files.length > IMAGE_MAX_FILES_PER_ADD) {
    candidates = files.slice(0, IMAGE_MAX_FILES_PER_ADD);
    rejections.add('count');
  }

  const accepted: File[] = [];
  for (const file of candidates) {
    // Type check (File.type is the browser's MIME detection; the server
    // does a content sniff as the authoritative check).
    if (!isAcceptedType(file.type)) {
      rejections.add('type');
      continue;
    }
    // Size check.
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections };
}
