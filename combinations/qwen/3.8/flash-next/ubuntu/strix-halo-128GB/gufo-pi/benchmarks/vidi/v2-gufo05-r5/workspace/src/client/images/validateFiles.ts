/**
 * Client-side file validation before any upload (story 12).
 *
 * A file that cannot become an image is turned away here, before a byte of it crosses the network,
 * and the person is told why in the wording the PRD fixes. The three checks - type, size, count -
 * are decided in that order: the two per-file checks first, so a drop of 21 files of which one is a
 * PDF adds the 20 real images and says both what was skipped and why.
 *
 * The check here is the cheap one (`File.type`, which the browser reads from the name and, for
 * well-registered types, the content). The Worker decides the type from the file's magic bytes, so
 * a PDF renamed `.png` that slips past this list is refused there and never stored. A file whose
 * bytes turn out not to decode as an image is dropped later, when its size is measured, with the
 * same message.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../shared/config';

/** Why a file was not added. One message is shown per reason, not per file. */
export type FileRejection = 'type' | 'size' | 'count';

/** The exact wording shown to the person for each reason, plus the offline case. */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: 'Only 20 images can be added at once.',
  offline: "You're offline \u2014 images can be added when you reconnect.",
};

/** True when the browser reports this file as one of the four accepted image types. */
export function isAcceptedFileType(file: File): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type);
}

/** True when this file is at or under the size a board may hold. */
export function isAcceptedFileSize(file: File): boolean {
  return file.size <= IMAGE_MAX_BYTES;
}

/**
 * Splits the files a person offered into those to add and the reasons the rest were not.
 *
 * `accepted` holds at most `IMAGE_MAX_FILES_PER_ADD` files, in the order they arrived; `rejections`
 * says which rules refused something (an empty set when everything was accepted).
 */
export function validateFiles(files: readonly File[]): {
  accepted: File[];
  rejections: Set<FileRejection>;
} {
  const rejections = new Set<FileRejection>();
  const supported: File[] = [];
  for (const file of files) {
    // one file that fails both rules still contributes both messages, exactly once each
    let ok = true;
    if (!isAcceptedFileType(file)) {
      rejections.add('type');
      ok = false;
    }
    if (!isAcceptedFileSize(file)) {
      rejections.add('size');
      ok = false;
    }
    if (ok) supported.push(file);
  }

  if (supported.length > IMAGE_MAX_FILES_PER_ADD) rejections.add('count');
  return { accepted: supported.slice(0, IMAGE_MAX_FILES_PER_ADD), rejections };
}
