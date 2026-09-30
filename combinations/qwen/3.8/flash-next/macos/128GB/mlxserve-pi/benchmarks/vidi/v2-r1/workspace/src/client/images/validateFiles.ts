// Deciding which files an add action may keep, before any upload starts
// (`image.types`, `image.size_limit`, `image.count_limit`).
//
// This is the *client's* first look at a drop, paste or pick: it sorts the files by
// the name they arrived with (`File.type`) and their size, drops the ones that
// clearly cannot be images or are too big, and caps the batch. It is deliberately
// not the last word on type — a file that claims to be a PNG but is really a renamed
// PDF passes the `File.type` check here and is caught one step later, when
// `createImageBitmap` fails to decode it, and again on the server, which sniffs the
// bytes. The three checks agree on the message a person sees, which is the point
// (`image.types`).
//
// What lives here:
//   - type: a file whose `File.type` is not one of IMAGE_ACCEPTED_TYPES is refused
//     with the type message;
//   - size: a file over IMAGE_MAX_BYTES is refused with the size message;
//   - count: once the type and size checks have been made, a batch larger than
//     IMAGE_MAX_FILES_PER_ADD keeps its first so many and shows the count message.
//
// Like every client file under `src/client`, this may touch the DOM (it talks about
// `File`); nothing here uploads anything or throws.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Adding images"
// (image.insert).
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

/** Why a file was refused, each one mapping to exactly one message. */
export type FileRejection = 'type' | 'size' | 'count';

/** The accepted MIME types, as a set for the `File.type` check. */
const ACCEPTED: ReadonlySet<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

/** What is left of an add action's files once the three checks are done. */
export interface ValidatedFiles {
  /** The files to add, in the order they arrived, capped at the count limit. */
  accepted: File[];
  /** Why files were refused — a set, so one drop of many bad files is one toast
   * per reason rather than one per file. Empty means every file was accepted. */
  rejections: Set<FileRejection>;
}

/**
 * The exact wording a person sees for each refusal (PRD `image.types`,
 * `image.size_limit`, `image.count_limit`) plus the offline case, which the hook
 * raises from the connection state rather than from a file.
 *
 * The numbers are read from the named settings rather than written out, so changing
 * IMAGE_MAX_BYTES or IMAGE_MAX_FILES_PER_ADD changes the promise and the message
 * together and they can never disagree.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: `Images must be ${IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller.`,
  count: `Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`,
  offline: "You're offline — images can be added when you reconnect.",
};

/**
 * Sort an add action's files into the ones to add and the reasons some were not.
 *
 * The order of the checks matters for the count message: type and size are decided
 * file by file first, and only the files that survive them count towards the
 * per-action limit — so a batch of 21 where one is a PDF adds 20 images and says
 * nothing about the count (the twenty that survived *are* the limit), while 21 real
 * images adds 20 and explains that the 21st was left out.
 */
export function validateFiles(files: readonly File[]): ValidatedFiles {
  const rejections = new Set<FileRejection>();
  const candidates: File[] = [];

  for (const file of files) {
    if (!ACCEPTED.has(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    candidates.push(file);
  }

  if (candidates.length > IMAGE_MAX_FILES_PER_ADD) {
    rejections.add('count');
    return { accepted: candidates.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
  }
  return { accepted: candidates, rejections };
}
