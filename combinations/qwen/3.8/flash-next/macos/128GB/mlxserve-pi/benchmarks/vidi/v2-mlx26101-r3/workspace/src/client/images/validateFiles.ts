/**
 * The files a person handed the board, split into the ones that can be added and the reasons the others
 * cannot.
 *
 * This is the first of the two gates a file goes through, and the only one that runs before a single byte
 * has been read. The second gate is the worker's, which reads the file's leading bytes
 * ({@link sniffImageType}) and does not believe the first one. That is not duplication so much as
 * defence: this gate exists so that a person gets told in the same second they dropped the file, with a
 * sentence that says what was wrong, rather than after an upload of something that was never going to
 * work. It cannot be trusted to be true, and it is not meant to be - a file whose `type` says `image/png`
 * is a file whose *name* ends in `.png`, which is a different claim. The worker decides; this only saves
 * the upload and does the explaining.
 *
 * Three rules, in the order the PRD states them:
 *
 * ```text
 * type    File.type is one of IMAGE_ACCEPTED_TYPES
 * size    File.size <= IMAGE_MAX_BYTES
 * count   at most IMAGE_MAX_FILES_PER_ADD of what survived the two rules above
 * ```
 *
 * The count rule is applied *after* the other two, which is what makes "21 valid files and 3 PDFs" a
 * count message rather than nothing at all: the PDFs were never candidates, and twenty-one is only
 * twenty-one among the files that could have been added.
 */
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD, isAcceptedImageType } from '../../shared/config';

/** The three things that can be wrong with a file, as the board's rules see it. */
export type FileRejection = 'type' | 'size' | 'count';

/**
 * What the board says, in the person's language, for each of them.
 *
 * The wording comes from the PRD and is kept in one place so that the toast a test asserts and the toast
 * a person reads are the same string from the same file. `offline` is here too because it is the same
 * kind of thing to say about the same button - it is not about a file, which is why it is not a
 * {@link FileRejection}: the board is not connected, so there is nowhere to upload to.
 */
export const REJECTION_MESSAGES: Readonly<Record<FileRejection | 'offline', string>> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** What came in: the files that may be added, and a set of the reasons the others may not be. */
export interface ValidatedFiles {
  readonly accepted: File[];
  readonly rejections: Set<FileRejection>;
}

/**
 * Split `files` into what can be added and why the rest cannot.
 *
 * The set, rather than a message per file, is the shape the PRD asks for: somebody who drops forty files
 * of which nine are too big wants to be told once that some were too big, not nine times. Which specific
 * files were dropped does not need saying - the ones that came in are on the board, and the ones that did
 * not are still where they were.
 *
 * Never throws, whatever it is handed.
 */
export function validateFiles(files: readonly File[]): ValidatedFiles {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();
  for (const file of files) {
    // The type first, and for a reason that outlives this function's own logic: a file that is not an
    // image was never a candidate, so it must not be counted against the twenty that may be added, and it
    // must not be measured against a limit that is about images.
    if (!isAcceptedImageType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      // The rest of the drop goes through. "Nothing added for that file" is what the PRD promises, and a
      // person who drops one photograph too big along with nine good ones gets nine photographs.
      rejections.add('size');
      continue;
    }
    accepted.push(file);
  }
  // The count last, because it is a statement about what is left: everything that survived the two rules
  // above could have been added, and the ones past the twentieth are what this message is about.
  const withinLimit = accepted.slice(0, IMAGE_MAX_FILES_PER_ADD);
  if (accepted.length > withinLimit.length) {
    rejections.add('count');
  }
  return { accepted: withinLimit, rejections };
}
