/**
 * Client-side file validation for image uploads: type, size, and count checks.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

const ACCEPTED_SET = new Set<string>(IMAGE_ACCEPTED_TYPES);

export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const typeValid: File[] = [];

  // First pass: filter by type and size
  for (const file of files) {
    if (!ACCEPTED_SET.has(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    typeValid.push(file);
  }

  // Second pass: apply count limit
  let accepted: File[];
  if (typeValid.length > IMAGE_MAX_FILES_PER_ADD) {
    accepted = typeValid.slice(0, IMAGE_MAX_FILES_PER_ADD);
    rejections.add('count');
  } else {
    accepted = typeValid;
  }

  return { accepted, rejections };
}
