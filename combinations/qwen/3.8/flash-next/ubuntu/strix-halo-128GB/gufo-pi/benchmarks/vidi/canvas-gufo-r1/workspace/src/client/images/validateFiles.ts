import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

const ACCEPTED_SET: Set<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

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

/**
 * Validate files for type, size and count.
 * Returns the first IMAGE_MAX_FILES_PER_ADD supported files.
 * Rejections is a set of rejection reasons encountered.
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
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
  }

  return { accepted, rejections };
}
