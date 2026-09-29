/**
 * Client-side pre-upload validation for board images (story 12, image.insert).
 *
 * The authoritative checks (type by content, size, rate limit) run on the
 * server; this is the fast, friendly gate that refuses files BEFORE uploading
 * (and produces the exact PRD messages). It checks the client's best signal —
 * `File.type` (the OS/browser-reported MIME type) and `File.size` — and the
 * per-action count.
 *
 * The server still re-sniffs by content (a file can carry a lying type), so a
 * renamed PDF or SVG is rejected there with 415 even if it slips past here.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@/shared/config';

export type FileRejection = 'type' | 'size' | 'count';

/**
 * Validates a batch of files for a single add action.
 *
 *  - 'count': only the first IMAGE_MAX_FILES_PER_ADD files are considered;
 *    a 'count' rejection is recorded when more were supplied.
 *  - 'type': files whose `File.type` is not one of IMAGE_ACCEPTED_TYPES are
 *    rejected (recorded once, if any).
 *  - 'size': files larger than IMAGE_MAX_BYTES are rejected (recorded once,
 *    if any).
 *
 * Order of evaluation per file: type first, then size (a file failing both is
 * rejected once under 'type'; both rejection kinds are still recorded if the
 * batch contains distinct failing files).
 */
export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

  if (files.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
  }

  const considered = files.slice(0, IMAGE_MAX_FILES_PER_ADD);
  for (const file of considered) {
    const type = file.type;
    const isAcceptedType =
      typeof type === 'string' && (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
    if (!isAcceptedType) {
      rejections.add('type');
      continue;
    }
    if (typeof file.size === 'number' && file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections };
}

/**
 * The exact PRD user-facing messages for each rejection, plus the offline and
 * rate-limit messages (image.offline, image.rate_limit).
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};
