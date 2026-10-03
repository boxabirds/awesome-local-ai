/**
 * Which files a board will take, and what is said about the ones it will not.
 *
 * Three questions, asked before a byte is uploaded (`image.types`, `image.size_limit`,
 * `image.count_limit`): is it one of the four accepted image types, is it within the size
 * limit, and is there room left in this one add action. Each "no" has exactly one message,
 * held here rather than written at each call site so the wording the PRD fixes stays one
 * wording.
 *
 * A file's declared `type` is the browser's guess at the format, which is why it is only
 * the first filter: the Worker decides from the bytes themselves (`image-format`), and a
 * file that passes here and fails there comes back as a failed upload rather than as
 * something stored.
 */
import type { AcceptedImageType } from '../../shared/config';
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/** Why a file was not added. */
export type FileRejection = 'type' | 'size' | 'count';

/** The exact words the PRD fixes for each refusal, and for a board that is offline. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** What one add action was given, sorted into what will be added and what was refused. */
export interface ValidatedFiles {
  accepted: File[];
  rejections: Set<FileRejection>;
}

/** Does this declared MIME type name one of the accepted images? */
export function isAcceptedFileType(type: string): type is AcceptedImageType {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Split `files` into the ones to add and the reasons for the rest.
 *
 * The order is the order the checks cost something: type and size are answered from the
 * `File` header the browser already has, and only what survives them is counted, so twenty
 * refusals produce "those are not images" rather than "too many images". The count limit
 * keeps the *first* twenty, because that is what a person who dropped twenty-five files
 * expects to keep — the ones their hand reached first.
 *
 * Each rejection is reported once, not once per file: twenty oversized photos are one
 * message about the size limit, not twenty of them.
 */
export function validateFiles(files: readonly File[]): ValidatedFiles {
  const rejections = new Set<FileRejection>();
  const usable: File[] = [];

  for (const file of files) {
    if (!isAcceptedFileType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    usable.push(file);
  }

  if (usable.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');

  return { accepted: usable.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
}
