import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/**
 * What the browser can decide about a batch of files before any of them travels.
 *
 * Every rule here is a copy of a rule the server also applies to the bytes (see
 * `src/shared/image-format.ts`), and it exists for two reasons: a person gets told
 * straight away instead of after an upload, and 10 MB of video is never pushed across
 * a network that was only ever going to refuse it. When the two disagree about *type*
 * — a PDF that arrived named `photo.png` — the server's judgement of the bytes wins,
 * and the same message is shown either way (PRD image.types).
 */

/** Why a file was not added. One word each, because the message is what is shown. */
export type FileRejection = 'type' | 'size' | 'count';

/**
 * The PRD's own sentences, kept here so the wording a person is promised is one
 * string in one place. `offline` is not about a file at all, but it is the fourth
 * reason nothing was added.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** A batch, sorted into what would be worth uploading and why the rest were not. */
export interface ValidatedFiles {
  /** In the order they arrived, and never more than `IMAGE_MAX_FILES_PER_ADD`. */
  accepted: File[];
  /** Each reason once, however many files it took. */
  rejections: Set<FileRejection>;
}

/** Is this a file type the product adds? The browser's own guess at the type only. */
function isAcceptedType(file: File): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type);
}

/**
 * Sort a drop, paste or pick into the files that may be added and the reasons the
 * others are not (PRD image.types, image.size_limit, image.count_limit).
 *
 * A wrong type or an oversized file costs only itself: the supported files from the
 * same action are still added. Type and size are settled first, so a 21st *supported*
 * file is what triggers the count — a batch of 40 rejected files is 40 refusals, not
 * 20 accepted ones.
 */
export function validateFiles(files: readonly File[]): ValidatedFiles {
  const rejections = new Set<FileRejection>();
  const supported: File[] = [];
  for (const file of files ?? []) {
    if (!isAcceptedType(file)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    supported.push(file);
  }
  if (supported.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  return { accepted: supported.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
}
