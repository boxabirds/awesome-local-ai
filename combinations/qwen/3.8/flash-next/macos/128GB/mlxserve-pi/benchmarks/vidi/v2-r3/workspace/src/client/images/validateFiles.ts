/*! Refusing files before any of them is uploaded (story 12).
 *
 * This is the first gate and the cheapest one: a file whose type or size the board
 * already knows it does not want never costs a request. It is not the *only* gate —
 * the Worker sniffs the bytes and refuses them again (worker/assets.ts), because a
 * browser's word about a file is a claim, and the board that has to keep the bytes
 * cannot take claims for an answer.
 *
 * The order of the checks is the order of the story: what a file *is* is asked
 * first, because a PDF is not too big, it is the wrong thing; how big it is comes
 * next; and how *many* comes last, because the twenty-first of twenty files that
 * are all fine is only rejected for being the twenty-first.
 *
 * ## What is checked here, and what only the bytes can say
 *
 * A browser reports a file's type from its name and from what the operating system
 * told it, which is why a PDF renamed `.png` still says `application/pdf` and is
 * refused here — and why a file whose type the browser was not told at all gets
 * through to the decode step, which is the second half of this rule: bytes that
 * will not decode as a picture are refused as the wrong type too, in
 * `useImageInsert`. The Worker's sniff is the last word.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/** Why a file was not wanted. */
export type FileRejection = 'type' | 'size' | 'count';

/** One file's answer, and the ones the board has words for. */
export interface FileValidation {
  /** The files to put on the board, in the order they arrived. */
  accepted: File[];
  /** Every reason a file was refused, once each. The board shows one toast per
   *  reason rather than one per file: forty wrong files are one refusal. */
  rejections: FileRejection[];
}

/**
 * What the board says about each refusal. These are the words from the PRD, and a
 * test checks them letter for letter because a message that says something else is
 * a message that does not answer the question that was asked.
 */
export const REJECTION_MESSAGES: Readonly<Record<FileRejection | 'offline', string>> = Object.freeze({
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
} as const);

/** The order messages are shown in: what it is, how big it is, how many, and the
 *  words for when there is nowhere to send them. */
export const REJECTION_ORDER: readonly FileRejection[] = Object.freeze(['type', 'size', 'count']);

/** Is this the kind of file the board keeps? Judged on the type the browser
 *  reported, which is a claim — see the note at the top of this file. */
export function isAcceptedFileType(file: File): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type);
}

/** Is this file small enough to be kept? */
export function isAcceptedFileSize(file: File): boolean {
  return file.size <= IMAGE_MAX_BYTES;
}

/**
 * Split a dropped, pasted or picked set of files into the ones to add and the
 * reasons for the ones not to.
 *
 * Twenty-one good files keep the first twenty and say why the rest did not make it
 * (image.bulk); a PDF and a PNG keep the PNG and say what was wrong with the other.
 * Nothing here throws, and nothing here is a surprise to upload: the accepted list
 * is exactly what will be uploaded, and everything refused is refused without a
 * request being made.
 */
export function validateFiles(files: readonly File[]): FileValidation {
  const rejections = new Set<FileRejection>();
  const good: File[] = [];
  for (const file of files) {
    if (!isAcceptedFileType(file)) {
      rejections.add('type');
      continue;
    }
    if (!isAcceptedFileSize(file)) {
      rejections.add('size');
      continue;
    }
    good.push(file);
  }

  // The count is decided last and on the files which were otherwise wanted: the
  // question "is there room for it?" only gets asked about something the board
  // would have taken.
  const accepted = good.slice(0, IMAGE_MAX_FILES_PER_ADD);
  if (good.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');

  return {
    accepted,
    rejections: REJECTION_ORDER.filter((kind) => rejections.has(kind)),
  };
}
