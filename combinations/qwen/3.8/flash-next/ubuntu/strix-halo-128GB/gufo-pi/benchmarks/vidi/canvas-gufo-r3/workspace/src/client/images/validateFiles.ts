import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();

  // Apply count limit first: only consider the first IMAGE_MAX_FILES_PER_ADD
  let candidates = files;
  if (files.length > IMAGE_MAX_FILES_PER_ADD) {
    candidates = files.slice(0, IMAGE_MAX_FILES_PER_ADD);
    rejections.add('count');
  }

  const accepted: File[] = [];
  for (const file of candidates) {
    // Type check: File.type must be in the accepted list
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      rejections.add('type');
      continue;
    }
    // Size check
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections };
}

export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};
