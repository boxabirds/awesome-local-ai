/**
 * Story 12: client-side file validation (image.insert).
 *
 * Applies the type, size and count limits BEFORE any upload (PRD
 * image.types / image.size_limit / image.count_limit). The server re-checks
 * size and type from content; this is the fast, user-facing gate.
 *
 * - type: `File.type` must be one of IMAGE_ACCEPTED_TYPES. Files whose
 *   content later fails to decode (`createImageBitmap`) get the same 'type'
 *   message at insert time.
 * - size: files larger than IMAGE_MAX_BYTES are rejected.
 * - count: only the first IMAGE_MAX_FILES_PER_ADD files are accepted.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export function validateFiles(files: readonly File[]): { accepted: File[]; rejections: Set<FileRejection> } {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];

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

/** Exact PRD toast wording, plus the offline message. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};
