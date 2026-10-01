// What the board says about a batch of files before it sends any of them anywhere.
//
// The rules are the PRD's and the messages are its wording: a file that cannot be added is
// named by kind, all of them at once, and one toast per kind however many files hit it -
// dropping forty files says "only 20 at once" once, not forty times.
//
// The type rule is the file's own declared type, which is the cheapest check there is and
// catches the ordinary case (a PDF, an .mp4, a dragged link). It cannot catch a file that
// lies about what it is, and this module does not pretend to: the bytes are read by the
// Worker before anything is stored (`worker/assets.ts` sniffs them), and a file the browser
// cannot decode is reported by the caller as the same `type` rejection. The extension is
// looked at nowhere, which is what makes a renamed PDF a rejection rather than a PNG.

import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

export type FileRejection = 'type' | 'size' | 'count';

export interface FileValidation {
  /** The files worth uploading, in the order they arrived. */
  accepted: File[];
  /** Each kind that was hit, once, in the order count, type, size. */
  rejections: FileRejection[];
}

export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: `Images must be ${IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller.`,
  count: `Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`,
  offline: "You're offline — images can be added when you reconnect.",
};

export function rejectionMessage(rejection: FileRejection | 'offline'): string {
  return REJECTION_MESSAGES[rejection];
}

function isAcceptedType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Split a batch into what can go and what cannot, naming every kind of thing that went wrong
 * exactly once.
 *
 * Every file in the batch is looked at, and no more than `IMAGE_MAX_FILES_PER_ADD` go: a
 * person who drops twenty-one files of which one is a PDF is told about the count *and* about
 * the PDF, because both are what they asked about. The files that go are the first ones that
 * are sound, in the order they arrived.
 *
 * A file that is both too big and of the wrong type is one loss and two reasons - the PRD's
 * mixed batch asks for every reason to appear together.
 */
export function validateFiles(files: readonly File[]): FileValidation {
  const accepted: File[] = [];
  let sawType = false;
  let sawSize = false;

  for (const file of files) {
    // both reasons are noticed for one file, because both are true of it
    const wrongType = !isAcceptedType(file.type);
    const tooBig = file.size > IMAGE_MAX_BYTES;
    if (wrongType) sawType = true;
    if (tooBig) sawSize = true;
    if (!wrongType && !tooBig && accepted.length < IMAGE_MAX_FILES_PER_ADD) accepted.push(file);
  }

  const rejections: FileRejection[] = [];
  if (files.length > IMAGE_MAX_FILES_PER_ADD) rejections.push('count');
  if (sawType) rejections.push('type');
  if (sawSize) rejections.push('size');
  return { accepted, rejections };
}

/**
 * The files of a drag or paste event, dropping anything that is not a file.
 *
 * A `FileList` and a plain array are both read: the DOM gives the first and a test double
 * gives the second, and the difference is not worth an assertion about.
 */
export function imageFilesOf(transfer: DataTransfer | null | undefined): File[] {
  if (transfer === null || transfer === undefined) return [];
  return listFiles(transfer.files);
}

function listFiles<Value>(list: ArrayLike<Value> & { item?(index: number): Value | null }): Value[] {
  const values: Value[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const value = typeof list.item === 'function' ? list.item(index) : list[index];
    if (value !== null && value !== undefined) values.push(value);
  }
  return values;
}

/**
 * Whether a drag is carrying files at all, which is what decides whether the board lights up
 * the drop highlight. A drag of a link or of selected text carries none, and the board stays
 * out of the way of both.
 */
export function dragCarriesFiles(transfer: DataTransfer | null | undefined): boolean {
  if (transfer === null || transfer === undefined) return false;
  return listFiles(transfer.types).includes('Files');
}
