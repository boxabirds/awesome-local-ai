// The client's first look at files before anything is uploaded (story 12, design
// `image.insert`). It answers three questions the PRD gives exact words for - is it
// an image we accept, is it small enough, are there too many at once - and says
// which of them went wrong, so the board can show the product's own message rather
// than a generic error (image.types, image.size_limit, image.count_limit).
//
// It decides the TYPE from the file's declared `File.type` only. That is the fast
// local gate; the real, unforgeable decision is the server's magic-byte sniff, which
// is why a file renamed `.png` that is really a PDF passes HERE and is caught on
// upload - and a file that lies about its dimensions fails at decode. This function
// never touches bytes and never throws.
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../shared/config.ts';

/** The three reasons a file can be refused before it is uploaded. */
export type FileRejection = 'type' | 'size' | 'count';

/**
 * The product's exact words, keyed by reason plus the two flow-level situations
 * (the board was offline; the upload was rate limited). These strings are the PRD's
 * and must not drift - the toasts render them verbatim.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline' | 'rate', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: 'You’re offline — images can be added when you reconnect.',
  rate: 'You’re adding images too quickly. Wait a minute and try again.',
};

/** Is this declared MIME type one of the four images the board accepts? */
export function isAcceptedFileType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

export interface FileValidation {
  /** the files that passed, in order, capped at IMAGE_MAX_FILES_PER_ADD */
  accepted: File[];
  /** which reasons came up, for the toast(s) to show */
  rejections: Set<FileRejection>;
}

/**
 * Split `files` into what to upload and why the rest were refused.
 *
 * The rules, applied in file order: a file whose type is not accepted is `type`;
 * one over IMAGE_MAX_BYTES is `size`; a file that is otherwise fine but would be
 * the 21st accepted file is `count`. A file rejected for type or size never uses up
 * a slot, so twenty valid images mixed with garbage still all get through - only
 * valid-but-excess files hit the count ceiling.
 */
export function validateFiles(files: readonly File[]): FileValidation {
  const accepted: File[] = [];
  const rejections = new Set<FileRejection>();
  for (const file of files) {
    if (!isAcceptedFileType(file.type)) {
      rejections.add('type');
      continue; // a wrong type never consumes a slot
    }
    if (file.size > IMAGE_MAX_BYTES) {
      rejections.add('size');
      continue; // an oversized file never consumes a slot either
    }
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      rejections.add('count');
      continue; // otherwise valid, but the batch is full
    }
    accepted.push(file);
  }
  return { accepted, rejections };
}
