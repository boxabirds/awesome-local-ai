import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

const ACCEPTED_SET = new Set<string>(IMAGE_ACCEPTED_TYPES);

/**
 * Validate files client-side: type, size, count.
 * Returns accepted files (up to IMAGE_MAX_FILES_PER_ADD) and a set of rejection kinds.
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const valid: File[] = [];

  for (const file of files) {
    if (!ACCEPTED_SET.has(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    valid.push(file);
  }

  if (valid.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    return { accepted: valid.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
  }

  return { accepted: valid, rejections };
}
