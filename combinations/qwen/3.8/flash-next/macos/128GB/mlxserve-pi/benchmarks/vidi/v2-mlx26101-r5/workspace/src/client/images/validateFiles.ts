/**
 * Which of these files is a picture this board can take.
 *
 * This is not a security check and it knows it: a browser's `File.type` is the extension's opinion, and
 * the Worker sniffs the bytes because the extension is a claim — a PDF renamed `.png` arrives here as
 * `image/png` and is refused four steps later by a magic number. So what this function is for is the other
 * thing: being able to tell a person, immediately and before a single byte crosses the network, that the
 * file they dropped is a PDF and never will be a picture. The server's 415 is the same sentence said after
 * an upload; this is the sentence said before one, and a person who is told in the moment does not sit
 * watching a progress bar that was never going to finish.
 *
 * It reports the *reasons*, as a set, and not per file — which is a decision about the interface rather
 * than laziness about the data. A drop of nine files of which four are wrong is one action, and a list of
 * which four and why is a table nobody reads; what the action needs is a sentence, and the sentence the
 * board has is three of them in {@link REJECTION_MESSAGES}. A batch in which both a PDF and a 40 MB file
 * were refused gets one toast naming both reasons in one line, because the two refusals are both true and a
 * toast that mentioned only one of them would be a toast that had read only half the batch — while two
 * toasts arriving at once would be one remark nobody can read. See {@link rejectionMessages}.
 *
 * What is *accepted* is the other half of the answer and the one that must be exact: PRD `image.types`
 * says the supported files from a mixed drop are still added, so nothing here may refuse a good file on
 * account of the bad ones beside it. A drop of a PDF and a PNG adds the PNG.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/** Why files were not added. `offline` is not a reason about a file, and so is not in this union. */
export type FileRejection = 'type' | 'size' | 'count';

/**
 * What the board says, in the PRD's own words.
 *
 * One place, so that the sentence the client shows, the sentence a test asserts and the sentence the PRD
 * specifies are the same string — three things that would otherwise drift, and drift is exactly what makes
 * a wording test worth writing. `offline` belongs in this record even though no file is ever refused for
 * it, because the message is raised by the same gesture as the other three: whoever has a reason on hand
 * wants the sentence that goes with it, and a fourth message kept somewhere else is a fourth place the
 * wording can disagree with itself.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** What came of a list of files. */
export interface ValidatedFiles {
  /** The ones to add, in the order they came, at most {@link IMAGE_MAX_FILES_PER_ADD} of them. */
  accepted: File[];
  /** Why the others were not, in the order the reasons were first met. Empty when all were accepted. */
  rejections: Set<FileRejection>;
}

/** Is this MIME type one of the four? (`File.type` is lower-case in every browser this board runs in.) */
export function isAcceptedFileType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Splits a drop, paste or picker result into files to add and the reasons the rest were not.
 *
 * The order of the three checks is the order of their usefulness: **type, then size, then count.** A file
 * of the wrong kind is refused before its size is mentioned, because "that is a PDF" is the more useful
 * sentence of the two and a 40 MB PDF should not be told it is too big when being smaller would not have
 * helped. The count is measured in *accepted* files, not in files: the PRD's limit is "more than 20
 * supported files", so eight pictures and six PDFs is a drop of eight pictures and none of the pictures is
 * refused for something that was never going to be added (TC-09: 21 valid files add the first twenty and
 * report `count`; a PDF-and-PNG mix adds the PNG and reports `type`).
 */
export function validateFiles(files: readonly File[]): ValidatedFiles {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();
  for (const file of files) {
    if (!isAcceptedFileType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      rejections.add('count');
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejections };
}

/**
 * What the board says about a set of reasons, in one line: the exact sentence for every reason, in a fixed
 * order rather than the order the reasons happened to be met in.
 *
 * The order is the order a person can act on: *what kind is this*, then *how big is it*, then *how many*.
 * A set of reasons iterates in the order its members were added, so a batch whose first file was oversized
 * and whose second was a PDF would be announced the other way round on a day that differed only in how
 * somebody happened to select their files — and a message that changes its own order at random is a message
 * a test cannot read and a person cannot learn.
 *
 * The strings themselves are not composed here: they come out of {@link REJECTION_MESSAGES} verbatim, joined
 * with a space, so the wording a test asserts and the wording the PRD specifies stay one string. Returns an
 * empty string when there is no reason, which the caller reads as "say nothing".
 *
 * It takes a set rather than a validation result because the caller sometimes learns a further reason after
 * the walk over the list — a file that turned out not to decode is a type reason, and nothing earlier in the
 * flow could have known it — and a line that can be said again with the new reason in it is better than a
 * second line spoken over the first.
 */
export function messagesFor(reasons: ReadonlySet<FileRejection>): string {
  const named: FileRejection[] = ['type', 'size', 'count'];
  const said: string[] = [];
  for (const reason of named) {
    if (reasons.has(reason)) said.push(REJECTION_MESSAGES[reason]);
  }
  return said.join(' ');
}

/** What the board says about a batch it has just looked at. See {@link messagesFor}. */
export function rejectionMessages(validated: ValidatedFiles): string {
  return messagesFor(validated.rejections);
}
