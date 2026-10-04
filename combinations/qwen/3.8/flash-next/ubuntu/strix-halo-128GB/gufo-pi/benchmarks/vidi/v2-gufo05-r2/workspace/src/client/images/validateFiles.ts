/**
 * Story 12: client-side file validation before upload.
 *
 * Checks accepted MIME type, maximum file size, and maximum count per action.
 * Returns the files that pass and the set of rejection reasons for the toast.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/**
 * Exact PRD wording for each rejection reason and the offline gate.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Validate files from a drop, paste, or picker action.
 *
 * Order: count limit first (keep first N), then per-file type and size checks.
 * Returns the accepted files and the set of rejection kinds encountered.
 */
export function validateFiles(
  files: readonly File[],
): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  let candidates = files;

  // Count limit: if more files than the max, accept only the first N and flag 'count'.
  if (candidates.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    candidates = candidates.slice(0, IMAGE_MAX_FILES_PER_ADD);
  }

  const accepted: File[] = [];
  for (const file of candidates) {
    if (!isAcceptedType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections };
}

function isAcceptedType(mime: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(mime);
}
