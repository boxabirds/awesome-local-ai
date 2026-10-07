/**
 * Which files a person may add to the board, and what to say about the rest
 * (`src/client/images/validateFiles.ts`, story 12).
 *
 * Three questions, asked in the order the answers get more expensive: is this one
 * of the four kinds of image (`image.types`), is it small enough to send
 * (`image.size_limit`), and are there too many of them at once
 * (`image.count_limit`). All three are answered from what the `File` object already
 * knows about itself - its reported type, its size, how many arrived in this one
 * gesture - so a 400 MB video is refused without a single byte of it being read,
 * let alone uploaded.
 *
 * The type check here is a *claim* check, not a decision. `File.type` is what the
 * operating system told the browser, and a PDF renamed `holiday.png` claims to be a
 * PNG all the way to this function. The decision is made from the bytes, twice: by
 * the browser when it tries to decode the file it is about to place
 * (`createImageBitmap`, in `useImageInsert`), and by the Worker from the first
 * twelve bytes of the body it was sent (`sniffImageType`). What this function is for
 * is the message - "Only PNG, JPEG, GIF and WebP images can be added." said before
 * anything is sent is a message the person can act on - and the Worker's 415 is the
 * one that is actually true.
 *
 * The other thing this file owns is the wording. Every string in
 * {@link REJECTION_MESSAGES} is the PRD's sentence, in the PRD's order, and the
 * numbers inside them come from the settings rather than being typed twice, so the
 * message and the limit cannot drift apart.
 */

import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
  isAcceptedImageType,
} from '../../shared/config.js';

/** Why a file was not added. One kind per reason, so one reason says one thing. */
export type FileRejection = 'type' | 'size' | 'count';

/** The megabyte the PRD's sentence counts (`IMAGE_MAX_BYTES` is 10 * 1024 * 1024). */
const MEGABYTES = IMAGE_MAX_BYTES / (1024 * 1024);

/**
 * What the board says about each refusal, in the PRD's own words.
 *
 * `offline` lives here as well, because it is the same kind of news - "nothing was
 * added, and this is why" - and because the toast that shows it should be able to
 * take its message from the same object as the rest.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: `Images must be ${MEGABYTES} MB or smaller.`,
  count: `Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`,
  offline: "You're offline \u2014 images can be added when you reconnect.",
};

/** What {@link validateFiles} decided. */
export interface ValidatedFiles {
  /** The files to add, in the order they arrived, at most {@link IMAGE_MAX_FILES_PER_ADD}. */
  accepted: File[];
  /** Why the others were not, one entry per *kind* of reason. */
  rejections: Set<FileRejection>;
}

/**
 * Split a batch of files into the ones to add and the reasons for the rest.
 *
 * A file is accepted only if it is a type the board accepts *and* small enough;
 * either failure leaves that file out and puts its reason in the set. Every file in
 * the batch is looked at, because the message is about the batch - a drop of twenty
 * images and one 40 MB video says "Images must be 10 MB or smaller." whatever order
 * they arrived in, and a check that stopped at the twentieth file would be a refusal
 * with nothing said about it.
 *
 * The count limit is on *supported* files, which is what the PRD's sentence is
 * actually about ("more than 20 supported files"): a PDF does not use up one of the
 * twenty places, and twenty images plus a PDF is a drop of twenty images - so it
 * gets one message about the PDF and no message about the count.
 *
 * The reasons are a `Set` rather than a list because the message is per *kind*: a
 * drop of six oversized PDFs says two sentences, not twelve.
 */
export function validateFiles(files: readonly File[]): ValidatedFiles {
  const rejections = new Set<FileRejection>();
  const accepted: File[] = [];
  const list = Array.isArray(files) ? files : [];
  // Past the twentieth supported file the rest are put aside, in order, and reported.
  let overflow = false;

  for (const file of list) {
    if (file === undefined || file === null) continue;
    // A file that is not one of the four types never gets as far as its size: the
    // type is the reason a person can act on, and a 40 MB PDF is a PDF first.
    if (!isAcceptedImageType(file.type)) {
      rejections.add('type');
      continue;
    }
    // Exactly at the limit is allowed (`image.size_limit` is "larger than").
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    // "the first 20 are added" - the limit is taken from the front, so what happens to
    // the rest is said out loud rather than left as a smaller board.
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      overflow = true;
      continue;
    }
    accepted.push(file);
  }
  if (overflow) rejections.add('count');
  return { accepted, rejections };
}

/** The messages for a set of rejections, in one fixed order (type, size, count). */
export function rejectionMessages(rejections: ReadonlySet<FileRejection>): string[] {
  const messages: string[] = [];
  for (const kind of ['type', 'size', 'count'] as const) {
    if (rejections.has(kind)) messages.push(REJECTION_MESSAGES[kind]);
  }
  return messages;
}
