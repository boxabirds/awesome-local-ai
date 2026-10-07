/**
 * Story 12 — Client-side file validation for image uploads.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@/shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Validate a list of files against accepted types, size limit, and count limit.
 * Returns accepted files and which rejection reasons apply.
 */
export function validateFiles(
  files: readonly File[]
): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  // Count limit: only consider first IMAGE_MAX_FILES_PER_ADD if more than that
  const limited = files.length > IMAGE_MAX_FILES_PER_ADD ? [...files.slice(0, IMAGE_MAX_FILES_PER_ADD)] : [...files];

  if (files.length > IMAGE_MAX_FILES_PER_ADD && !rejections.has('count')) {
    rejections.add('count');
  }

  for (const file of limited) {
    // Type check by MIME type
    const acceptedTypes = IMAGE_ACCEPTED_TYPES;
    if (!(acceptedTypes as readonly string[]).includes(file.type)) {
      if (!rejections.has('type')) {
        rejections.add('type');
      }
      continue;
    }

    // Size check
    if (file.size > IMAGE_MAX_BYTES) {
      if (!rejections.has('size')) {
        rejections.add('size');
      }
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejections };
}
