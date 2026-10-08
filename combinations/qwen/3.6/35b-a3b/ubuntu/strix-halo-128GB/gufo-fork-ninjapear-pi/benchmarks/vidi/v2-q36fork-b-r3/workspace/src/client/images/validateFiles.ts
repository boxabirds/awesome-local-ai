/** Client-side file validation for story 12 — type, size, and count checks */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';
type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

export type FileRejection = 'type' | 'size' | 'count';

/** Exact rejection messages matching the PRD. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
} as const;

/**
 * Validate an array of files by type and size.
 * Returns accepted files (in original order, first IMAGE_MAX_FILES_PER_ADD) and which rejection categories occurred.
 */
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejections: Set<FileRejection>;
} {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();

  // Count limit check across all files first
  const filteredByTypeAndSize: File[] = [];
  for (const file of files) {
    // Size check
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    // Type check — use the file's MIME type
    if (file.type && !IMAGE_ACCEPTED_TYPES.includes(file.type as AcceptedImageType)) {
      rejections.add('type');
      continue;
    }
    // For files with no type (e.g., some older browsers), accept them to be sniffed server-side
    // Actually per design, we should only accept files that have a recognized type
    if (!file.type) {
      rejections.add('type');
      continue;
    }
    filteredByTypeAndSize.push(file);
  }

  // Apply count limit
  if (filteredByTypeAndSize.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
  }

  accepted.push(...filteredByTypeAndSize.slice(0, IMAGE_MAX_FILES_PER_ADD));

  return { accepted, rejections };
}
