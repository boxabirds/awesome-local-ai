// Story 12: client-side validation of files before anything is decoded or
// uploaded (image.types, image.size_limit, image.count_limit). Rejections
// carry the exact PRD message wording; a rejected file never blocks the
// supported files from the same action.

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

const ACCEPTED = new Set<string>(IMAGE_ACCEPTED_TYPES);

// Type is judged by the browser-reported MIME type here; the server makes the
// final decision from magic bytes (assets.api), so a disguised file is still
// refused before serving even if a clipboard/drop misreports its type.
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejections: Set<FileRejection>;
} {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  for (const file of files) {
    if (!ACCEPTED.has(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }
  if (accepted.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
  }
  return { accepted, rejections };
}
