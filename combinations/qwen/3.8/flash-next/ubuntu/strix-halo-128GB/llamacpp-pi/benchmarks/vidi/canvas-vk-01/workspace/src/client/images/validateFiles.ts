import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/**
 * Client-side file screening, done before anything is uploaded (`image.types`,
 * `image.size_limit`, `image.count_limit`). The server sniffs content and can
 * still refuse a file; this exists so a user is never left watching an upload
 * that was doomed, and so the exact PRD messages live in one place.
 */

/** Why a file was not added. One message per reason, not per file. */
export type FileRejection = 'type' | 'size' | 'count';

/** Message keys: the file-level refusals plus the two service-level ones. */
export type ImageMessageKey = FileRejection | 'offline' | 'rate';

/**
 * The PRD's wording, verbatim (`image.types`, `image.size_limit`,
 * `image.count_limit`, `image.offline`, `image.rate_limit`). Tests assert
 * against these strings, and so does the toast.
 */
export const REJECTION_MESSAGES: Record<ImageMessageKey, string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
  rate: "You're adding images too quickly. Wait a minute and try again.",
};

const ACCEPTED: ReadonlySet<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

export interface ValidationResult {
  /** The files to add, in the user's order, capped at IMAGE_MAX_FILES_PER_ADD. */
  accepted: File[];
  /** Why the rest were refused; empty when every file was accepted. */
  rejections: Set<FileRejection>;
}

/**
 * Split a batch into what can be added and why the rest cannot (`image.types`,
 * `image.size_limit`, `image.count_limit`). Files keep the order they arrived in,
 * and the count cap applies to the files that were otherwise accepted, because
 * the PRD counts supported files.
 */
export function validateFiles(files: readonly File[]): ValidationResult {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  for (const file of files) {
    // `File.type` is the browser's guess from the extension. It screens out the
    // obvious cases cheaply; the server's sniff and the browser's decode are what
    // catch a file wearing a name it does not deserve.
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
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
    rejections.add('count');
  }
  return { accepted, rejections };
}
