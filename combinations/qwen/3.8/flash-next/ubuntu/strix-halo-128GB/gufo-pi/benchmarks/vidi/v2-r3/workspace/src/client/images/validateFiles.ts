import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

export interface ValidationResult {
  accepted: File[];
  rejections: Set<FileRejection>;
}

/**
 * Validate files for type, size and count.
 * - Type: file must have an accepted MIME type.
 * - Size: file must be ≤ IMAGE_MAX_BYTES.
 * - Count: at most IMAGE_MAX_FILES_PER_ADD files accepted.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  for (const file of files) {
    // Check type
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
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
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
  }

  return { accepted, rejections };
}
