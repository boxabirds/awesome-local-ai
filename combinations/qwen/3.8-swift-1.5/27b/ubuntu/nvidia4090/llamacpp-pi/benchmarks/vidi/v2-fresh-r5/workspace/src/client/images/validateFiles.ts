/**
 * Client-side file validation for image uploads (story 12).
 * Checks type, size, and count limits before any upload is attempted.
 */
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Validate a set of files for image upload.
 * - Rejects files whose MIME type is not in IMAGE_ACCEPTED_TYPES ('type').
 * - Rejects files larger than IMAGE_MAX_BYTES ('size').
 * - Limits to first IMAGE_MAX_FILES_PER_ADD files ('count').
 *
 * Returns the accepted files (in order) and the set of rejection reasons
 * that occurred (for toast messages).
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  // First filter by type and size
  const typeAndSizeOk: File[] = [];
  for (const file of files) {
    const isAcceptedType = (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type);
    if (!isAcceptedType) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    typeAndSizeOk.push(file);
  }

  // Then apply count limit
  if (typeAndSizeOk.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
  }

  const limit = Math.min(typeAndSizeOk.length, IMAGE_MAX_FILES_PER_ADD);
  for (let i = 0; i < limit; i++) {
    accepted.push(typeAndSizeOk[i]);
  }

  return { accepted, rejections };
}
