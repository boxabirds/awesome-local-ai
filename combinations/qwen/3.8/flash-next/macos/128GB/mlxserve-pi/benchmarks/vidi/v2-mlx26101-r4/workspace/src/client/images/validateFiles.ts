/**
 * Which files the board takes, and what it says about the ones it does not (story 12).
 *
 * A drop, a paste or a pick can contain anything: four screenshots and a contract, twenty-one files from a
 * folder, a 40 MB raw photo. All three ways in end up here, so there is one answer to *does the board take
 * this file?* and one sentence for each way a file can be refused.
 *
 * What is deliberately *not* here: reading the file's bytes (the server sniffs those, and refuses a file that
 * lied about what it is), decoding it (the insert asks the browser for its dimensions), and uploading. This is
 * a decision about a list of files and nothing else — which is why the whole of the board's front-door policy
 * fits in a function that never waits for anything.
 */

import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD, isAcceptedImageType } from '../../shared/config';

/** A way a file can be refused. One per *kind* of refusal, not one per file. */
export type FileRejection = 'type' | 'size' | 'count';

/** Anything the board tells the person who just tried to add something that could not be added. */
export type ImageMessageKind = FileRejection | 'offline';

/**
 * What each refusal says out loud.
 *
 * One sentence per kind, so that dropping forty files of which six are the wrong type produces one line on the
 * board and not six, and so that the sentence a test asserts is the sentence the design says the person hears.
 * The limit is in the words because a person who is told *too big* and nothing else has no idea how big they
 * are allowed to go.
 */
export const REJECTION_MESSAGES: Readonly<Record<ImageMessageKind, string>> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: `Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`,
  offline: 'You’re offline — images can be added when you reconnect.',
};

/** What the board decided about a batch of files: the ones it will take, and the kinds of refusal it hit. */
export interface ValidatedFiles {
  readonly accepted: File[];
  /** The kinds of thing that went wrong, each named once. A person needs to know *that* a PDF was turned
   *  away and *that* a file was too big, not which of the forty each one was. */
  readonly rejections: Set<FileRejection>;
}

/**
 * The files the board will take, out of the ones it was handed.
 *
 * A file is refused for being the wrong type by what the browser says it *is* — a PDF renamed `.png` still
 * arrives as `application/pdf`, and the name is not a fact about the file. A file is refused for size at
 * strictly more than `IMAGE_MAX_BYTES`, so one exactly at the limit gets in: the limit is what the board will
 * store, and a file of exactly that many bytes is storeable.
 *
 * The count limit is applied last, to the files that were otherwise wanted: twenty-one images and a PDF lose
 * the PDF *and* the twenty-first image, but the twentieth image is not lost to a file that was never a
 * candidate. The files past the limit are skipped, and skipping is said out loud — a person who dropped
 * twenty-one and got twenty has to be able to find out where the twenty-first went.
 */
export function validateFiles(files: readonly File[]): ValidatedFiles {
  const rejections = new Set<FileRejection>();
  const wanted: File[] = [];

  for (const file of files) {
    if (!isAcceptedImageType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    wanted.push(file);
  }

  const accepted = wanted.slice(0, IMAGE_MAX_FILES_PER_ADD);
  if (wanted.length > accepted.length) rejections.add('count');

  return { accepted, rejections };
}
