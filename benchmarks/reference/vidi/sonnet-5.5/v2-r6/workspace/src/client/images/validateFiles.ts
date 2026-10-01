import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

const ACCEPTED = new Set<string>(IMAGE_ACCEPTED_TYPES);

/** Keeps supported files within the size limit, at most IMAGE_MAX_FILES_PER_ADD of them, and says why others went. */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  for (const file of files) {
    if (!ACCEPTED.has(file.type)) rejections.add('type');
    else if (file.size > IMAGE_MAX_BYTES) rejections.add('size');
    else accepted.push(file);
  }
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
    rejections.add('count');
  }
  return { accepted, rejections };
}
