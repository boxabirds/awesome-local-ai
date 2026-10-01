import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** Type (by the browser's detected type), size and count checks; the first IMAGE_MAX_FILES_PER_ADD supported files are kept. */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const supported: File[] = [];
  for (const file of files) {
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) rejections.add('type');
    else if (file.size > IMAGE_MAX_BYTES) rejections.add('size');
    else supported.push(file);
  }
  if (supported.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  return { accepted: supported.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
}
