// Client-side file validation (story 12, image.insert): the browser refuses
// unsupported types, oversized files and excess counts BEFORE anything is
// uploaded, and surfaces the exact PRD messages for what it refused.

import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/**
 * Validate the files of one drop/paste/pick. Returns the accepted files
 * (at most IMAGE_MAX_FILES_PER_ADD, in their original order) and the set of
 * rejection kinds that occurred. Pure: no uploads, no DOM.
 */
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejections: Set<FileRejection>;
} {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();
  for (const file of files) {
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      rejections.add('count');
      continue;
    }
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejections };
}

/**
 * The exact PRD wording for each rejection kind (image.types,
 * image.size_limit, image.count_limit) plus the offline message
 * (image.offline).
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};
