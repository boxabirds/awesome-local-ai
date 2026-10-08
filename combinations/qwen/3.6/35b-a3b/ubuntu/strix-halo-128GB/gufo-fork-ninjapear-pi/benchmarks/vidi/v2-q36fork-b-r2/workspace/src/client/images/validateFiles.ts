import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

const ACCEPTED_TYPE_SET: Set<string> = new Set(IMAGE_ACCEPTED_TYPES);

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Validate a list of files for image upload.
 * Returns accepted files (up to limit) and which rejections occurred.
 */
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejections: Set<FileRejection>;
} {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();

  // Check count first
  if (files.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
  }

  // Process each file
  const maxFiles = Math.min(files.length, IMAGE_MAX_FILES_PER_ADD);
  for (let i = 0; i < maxFiles; i++) {
    const file = files[i];
    // Check type by MIME type
    if (!ACCEPTED_TYPE_SET.has(file.type)) {
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

  return { accepted, rejections };
}
