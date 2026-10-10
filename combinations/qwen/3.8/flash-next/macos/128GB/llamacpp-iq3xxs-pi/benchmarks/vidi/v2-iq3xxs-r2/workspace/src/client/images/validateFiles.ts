import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';
import type { AcceptedImageType } from '../../shared/image-format';

/**
 * The browser's half of the file rules (story 12, `image.types`, `image.size_limit`,
 * `image.count_limit`).
 *
 * A file can arrive from a drop, a paste or the picker, and the server will refuse anything
 * it does not recognise — but refusing it there means a spinner, a failed upload and a box on
 * the board before anybody is told anything. So the questions answered here are only ever
 * "can this file be worth asking about", judged from what the browser already knows about it:
 * its declared type, its size and how many came at once. A renamed PDF passes every check
 * here and is refused later, by the server's magic-byte sniffing and by the failed decode.
 */

/** Why a file did not make it into the add action. */
export type FileRejection = 'type' | 'size' | 'count';

/** What a viewer is told, per reason, in the words the PRD specifies. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** Does this file claim to be one of the kinds the board serves? */
function isAcceptedType(file: File): boolean {
  // `File.type` is the browser's guess at the MIME type from the name and, in a real browser,
  // from the contents; an empty one means it had no idea, and no idea is not a PNG.
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type);
}

/**
 * Split what was asked for into what can be uploaded and why the rest was not.
 *
 * `rejections` holds the *reasons* that came up, not a per-file list, because that is what a
 * person needs: one toast per kind of refusal, whichever of the three ways in they used.
 *
 * The count limit is applied to what survived the other two checks, and it keeps the files
 * the person named first: a drop of 40 photos is a person who means to add 40 photos, and
 * telling them the other 20 are coming in a second drop is kinder than refusing all 40.
 */
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejections: Set<FileRejection>;
} {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  for (const file of files) {
    if (!isAcceptedType(file)) {
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
    rejections.add('count');
    accepted.length = IMAGE_MAX_FILES_PER_ADD;
  }
  return { accepted, rejections };
}

/** The MIME type a `File` claims, or null when it claims nothing useful. */
export function claimedType(file: File): AcceptedImageType | null {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)
    ? (file.type as AcceptedImageType)
    : null;
}
