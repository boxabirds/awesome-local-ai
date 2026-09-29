/**
 * Story 12: client-side file validation (image.insert unit, TC-08/TC-09).
 *
 * Rules, in order, per file: count (keep the first IMAGE_MAX_FILES_PER_ADD
 * accepted files), then type (must be one of IMAGE_ACCEPTED_TYPES), then
 * size (≤ IMAGE_MAX_BYTES). Rejections are a Set of codes so one toast per
 * reason per action, in the PRD wording.
 */
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from 'src/shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export interface ValidationResult {
  /** The files to upload, in original order. */
  accepted: File[];
  /** At most one entry per rejection reason. */
  rejections: Set<FileRejection>;
}

/** Exact PRD wording for every rejection reason (plus the offline gate). */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

export function validateFiles(files: readonly File[]): ValidationResult {
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
