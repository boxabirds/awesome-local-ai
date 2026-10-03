// The first gate an image file passes through (story 12): before anything is uploaded, before
// anything is written to the shared board, this decides whether the file stands a chance.
//
// It is a filter, not a validator that stops at the first problem: one drop of nine valid images
// with one too big and one document mixed in has to put the nine on the board and say once each what
// was left out (image.mixed_batch). So the reasons come back as a set and the caller shows one toast
// per reason rather than one per file.
//
// The type check here is the file's own claim (`File.type`), which is cheap and catches the obvious
// cases. It is not trusted: the Worker reads the magic bytes and answers 415 for a file that lies
// (image.sniff), and that answer arrives as its own toast. Checking twice is the point — a person
// should not have to wait for an upload to be told a file was never an image, and a board must not
// fill up with objects whose bytes were never going to be stored.

import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config';

/** Why a file was not taken. `offline` is not about a file, but it is said the same way. */
export type FileRejection = 'type' | 'size' | 'count';

/** What a person is told, in the words the PRD asks for. */
export const REJECTION_MESSAGES: Readonly<Record<FileRejection | 'offline', string>> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline — images can be added when you reconnect.",
};

/** The message for a reason, ready for the toast. */
export function rejectionMessage(reason: FileRejection | 'offline'): string {
  return REJECTION_MESSAGES[reason];
}

/**
 * A file, as far as this module cares. `File` itself is not used as the parameter type because
 * nothing here reads anything but these three fields: the tests hand in files that were never
 * attached to a form, and a real `File` satisfies it anyway.
 */
export interface ImageFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export interface FilePlan<T extends ImageFile = ImageFile> {
  /** What may be uploaded, in the order it arrived, never more than IMAGE_MAX_FILES_PER_ADD. */
  readonly accepted: T[];
  /** Why the rest was left out. A set, because nine oversized files are one message, not nine. */
  readonly rejections: ReadonlySet<FileRejection>;
}

/** Is this a media type the board takes? (The Worker decides the real answer from the bytes.) */
export function isAcceptedImageType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Split a pile of files into what can go onto the board and why the rest cannot
 * (image.accepted_types / image.too_large / image.max_files / image.mixed_batch).
 *
 * The checks run in the order a person would want the answers: is it an image at all, is it far too
 * big, and only then — once the files that are individually fine are known — is there room for all of
 * them. An oversized file is reported as oversized even if it also happened to be the 21st file;
 * which of the two reasons is nearer the truth matters less than naming one of them correctly.
 */
export function validateFiles<T extends ImageFile>(files: readonly T[]): FilePlan<T> {
  const accepted: T[] = [];
  const rejections = new Set<FileRejection>();

  for (const file of files) {
    if (!isAcceptedImageType(file.type)) {
      rejections.add('type');
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue;
    }
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      // Everything past the cap is a valid image there is simply no room for, which is a different
      // thing from a file that was never acceptable.
      rejections.add('count');
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections };
}
