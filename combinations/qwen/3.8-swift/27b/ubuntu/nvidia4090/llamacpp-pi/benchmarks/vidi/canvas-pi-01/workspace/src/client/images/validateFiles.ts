// Client-side file validation for image adds (spec: image.insert).
//
// Pure pre-upload gate: keeps the first IMAGE_MAX_FILES_PER_ADD files
// (image.count_limit), rejects files whose MIME type is not one of
// IMAGE_ACCEPTED_TYPES (image.types) and files over IMAGE_MAX_BYTES
// (image.size_limit). `File.type` is the browser's own sniff from the
// extension/mime; the worker re-decides from content bytes, so a disguised
// file that slips past here is still refused there (415).
//
// REJECTION_MESSAGES hold the exact PRD toast wording; the hook toasts one
// message per distinct rejection kind of the action.

import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/** Exact PRD strings (image.types, image.size_limit, image.count_limit,
 *  image.offline, image.rate_limit) plus the two non-file messages. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

export interface ValidateFilesResult {
  /** Files that pass every check, in input order. */
  accepted: File[];
  /** Distinct rejection kinds that occurred (for toasting). */
  rejections: Set<FileRejection>;
}

export function validateFiles(files: readonly File[]): ValidateFilesResult {
  const rejections = new Set<FileRejection>();
  let pool = files;
  if (pool.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    pool = pool.slice(0, IMAGE_MAX_FILES_PER_ADD);
  }
  const accepted: File[] = [];
  for (const file of pool) {
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
