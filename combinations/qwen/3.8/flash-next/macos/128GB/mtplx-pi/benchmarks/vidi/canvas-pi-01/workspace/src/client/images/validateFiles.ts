/**
 * Story 12 · client-side file validation (design "Adding images",
 * `image.insert`).
 *
 * The three pre-upload rules — count, type and size — are applied here before
 * anything reaches the network, so an unsupported or oversized file is refused
 * with a clear message rather than a failed upload (PRD image.types,
 * image.size_limit, image.count_limit). Type is judged from `File.type`, which
 * the browser derives from a file's content; the Worker re-checks the same rule
 * from magic bytes, so a disguised file is refused twice over.
 *
 * `validateFiles` never throws and never mutates its input. It reports the
 * *kinds* of rejection that occurred (a `Set`), not one message per file,
 * because the UI shows one toast per reason (the PRD lists exactly these
 * messages). A count overflow adds the first {@link IMAGE_MAX_FILES_PER_ADD}
 * files and flags `'count'`; the accepted list then holds only files that are
 * also a supported type and within the size limit.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/** Why one add action was partially or wholly refused. */
export type FileRejection = 'type' | 'size' | 'count';

/** Every user-facing message the image flow can show, keyed by its cause. */
export type ImageMessage = FileRejection | 'offline' | 'rate';

/**
 * The exact PRD wording for each message. Kept in one place so the toast, the
 * e2e assertions and the PRD cannot drift apart.
 */
export const REJECTION_MESSAGES: Record<ImageMessage, string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

/** True when `type` is one of the four accepted image MIME types. */
export function isAcceptedType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

export interface ValidationResult {
  /** Files that passed every rule and should be uploaded. */
  accepted: File[];
  /** The reasons any file was refused (a toast is shown for each). */
  rejections: Set<FileRejection>;
}

/**
 * Apply the three rules to one add action. Count is applied first (only the
 * first {@link IMAGE_MAX_FILES_PER_ADD} files are candidates for the batch);
 * within those, a wrong type flags `'type'` and an oversized file flags
 * `'size'`. A file can trip both, and both reasons are reported.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();

  // Count first: more than the per-action allowance keeps the first N and warns.
  let candidates = files;
  if (files.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    candidates = files.slice(0, IMAGE_MAX_FILES_PER_ADD);
  }

  const accepted: File[] = [];
  for (const file of candidates) {
    // Type first: a disguised / unsupported file is never measured for size.
    if (!isAcceptedType(file.type)) {
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
