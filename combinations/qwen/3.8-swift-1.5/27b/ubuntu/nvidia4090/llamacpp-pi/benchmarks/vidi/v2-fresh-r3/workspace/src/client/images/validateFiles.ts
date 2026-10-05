import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/**
 * Client-side image file validation (story 12, image.insert). Runs before any
 * upload: type (MIME), size (IMAGE_MAX_BYTES) and count
 * (IMAGE_MAX_FILES_PER_ADD). The server re-checks type by content and size
 * (assets.api).
 */

export type FileRejection = 'type' | 'size' | 'count';

/** Exact PRD messages for every rejection class plus the offline gate. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Validates a batch of files for one add action. Returns the accepted files
 * (first IMAGE_MAX_FILES_PER_ADD that pass the type and size checks) and the
 * set of rejection classes that occurred (for toasts).
 */
function isAcceptedType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  for (const file of files) {
    // Count limit: only the first IMAGE_MAX_FILES_PER_ADD are ever added.
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      rejections.add('count');
      continue;
    }
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
