// Client-side file validation (story 12, image.insert): type, size and
// count pre-checks with the exact PRD messages. The server re-validates by
// magic bytes (assets.api); this keeps obviously bad files off the wire and
// produces the user-facing toasts.

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/** Why a file was refused in an add action. */
export type FileRejection = 'type' | 'size' | 'count';

/** Exact PRD wording for every refusal, plus the offline and rate-limit
 *  messages (image.types, image.size_limit, image.count_limit,
 *  image.offline, image.rate_limit). */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

/**
 * Validates a batch of files against the count, type and size limits.
 *
 * - Count first: only the first IMAGE_MAX_FILES_PER_ADD files are
 *  considered; a batch larger than that adds 'count' to the rejections
 *  (image.count_limit).
 * - Type: File.type must be one of IMAGE_ACCEPTED_TYPES ('type').
 * - Size: files larger than IMAGE_MAX_BYTES are refused ('size').
 *
 * Supported files in the same batch are still accepted (image.types
 * alternate flow).
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const considered = files.slice(0, IMAGE_MAX_FILES_PER_ADD);
  if (files.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');

  const accepted: File[] = [];
  for (const file of considered) {
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
