/**
 * Client-side file validation for image adds (story 12, TC-08, TC-09).
 *
 * Runs before any upload (drop, paste and the picker all funnel through it).
 * A file is accepted only when its MIME type is one of IMAGE_ACCEPTED_TYPES
 * and its size is at most IMAGE_MAX_BYTES. An add accepts at most
 * IMAGE_MAX_FILES_PER_ADD files (the first ones in file order).
 *
 * The worker re-checks everything against real bytes — this is the UX gate,
 * not the trust boundary.
 */
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

/** The rejection categories, in the order the toasts must appear. */
export type FileRejection = 'type' | 'size' | 'count';

/** Toast copy for every rejection category and the offline gate (exact PRD strings). */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

export interface ValidationResult {
  readonly accepted: File[];
  /** The distinct rejection categories seen, in first-seen order (for the toasts). */
  readonly rejections: FileRejection[];
}

/**
 * Validate a list of picked / dropped / pasted files. Returns the accepted
 * files (at most IMAGE_MAX_FILES_PER_ADD, in file order) and the distinct
 * rejection categories — one toast per category, no per-file repetition.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const accepted: File[] = [];
  const rejections: FileRejection[] = [];
  const seen = new Set<FileRejection>();
  const reject = (r: FileRejection): void => {
    if (!seen.has(r)) {
      seen.add(r);
      rejections.push(r);
    }
  };
  for (const f of files) {
    const type = typeof f.type === 'string' ? f.type : '';
    if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type)) {
      reject('type');
      continue;
    }
    const size = Number(f.size);
    if (!Number.isFinite(size) || size > IMAGE_MAX_BYTES) {
      reject('size');
      continue;
    }
    if (accepted.length < IMAGE_MAX_FILES_PER_ADD) {
      accepted.push(f);
    } else {
      reject('count');
    }
  }
  return { accepted, rejections };
}
