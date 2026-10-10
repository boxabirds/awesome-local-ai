import { IMAGE_ACCEPTED_TYPES, IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD, IMAGE_SNIFF_BYTES } from '../../shared/config';
import { sniffImageType } from '../../shared/image-format';

/**
 * The client-side file gate (anchor `images.validation`).
 *
 * What a person may add is decided here, in one place, before anything is
 * written to the document or uploaded:
 *
 * ```mermaid
 * flowchart LR
 *   file[one File] --> size{size > IMAGE_MAX_BYTES?}
 *   size -- yes --> size_no[size]
 *   size -- no --> capacity{within IMAGE_MAX_FILES_PER_ADD?}
 *   capacity -- no --> count_no[count]
 *   capacity -- yes --> sniff[sniffImageType of first IMAGE_SNIFF_BYTES]
 *   sniff -->|"accepted"| keep[accepted]
 *   sniff -->|null| type_no[type]
 * ```
 *
 * The order is deliberate: size is the cheapest answer and the one a person has
 * to act on, the file count is a rule about *this add* rather than about one
 * file, and only then is the content looked at.
 *
 * `File.name` is never consulted and `File.type` is never believed: TC-08 gives
 * the gate a PDF named `.png` (rejected) and a real JPEG named `.txt` (accepted).
 * The sniff runs on the file's own bytes, which a `File` hands out a slice of
 * without loading the whole thing, so a 10 MB file costs 12 bytes of attention
 * here.
 *
 * The server-side gate (`src/worker/assets.ts`) repeats the content and size
 * rules on the bytes it actually receives: this one is for the person, that one
 * is for the storage.
 *
 * **Deviation from the design's signature**: `validateFiles` is `async` and
 * returns one rejection record per rejected file. Reading the head of a `File`
 * is `await file.slice(0, n).arrayBuffer()` in every browser, so a synchronous
 * gate cannot sniff content at all; and a toast that says *which* file was
 * refused is a better toast than a set of reasons. `reasons` carries the design's
 * set alongside them.
 */

/** Why one file was not added (`image.types`, `image.size_limit`, `image.count_limit`). */
export type FileRejection = 'type' | 'size' | 'count';

/** One file that was not added, and why. */
export interface FileRejectionInfo {
  readonly file: File;
  readonly reason: FileRejection;
  readonly message: string;
}

/** What to insert, and what to tell the person about. */
export interface FileValidation {
  readonly accepted: File[];
  readonly rejections: FileRejectionInfo[];
  /** The distinct reasons, in the order they first appeared. */
  readonly reasons: Set<FileRejection>;
}

/**
 * What a person is told (TC-09), in the product's own words. Keyed by reason -
 * including `offline`, which is not a property of a file but of the moment - so
 * the gate, the toast and the tests all read the same strings.
 */
export const REJECTION_MESSAGES: Record<FileRejection | 'offline', string> = {
  type: 'Only PNG, JPEG, GIF and WebP images can be added.',
  size: 'Images must be 10 MB or smaller.',
  count: `Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`,
  offline: "You're offline — images can be added when you reconnect.",
};

/** The `accept` attribute the file picker is built with (`images.picker`). */
export const IMAGE_ACCEPT_ATTRIBUTE = IMAGE_ACCEPTED_TYPES.join(',');

/** The front of a file, read without loading the whole thing. */
async function headOf(file: File): Promise<Uint8Array> {
  const end = Math.min(file.size, IMAGE_SNIFF_BYTES);
  return new Uint8Array(await file.slice(0, end).arrayBuffer());
}

/**
 * Split the files of one drop, paste or picker add into what may be inserted
 * and what must be explained (TC-08, TC-09).
 *
 * Empty input is not an error: it is nothing to insert. Files beyond
 * `IMAGE_MAX_FILES_PER_ADD` are named in the response as rejected rather than
 * silently dropped, so the person can see that the 21st file is the one that is
 * missing.
 */
export async function validateFiles(files: readonly File[]): Promise<FileValidation> {
  const accepted: File[] = [];
  const rejections: FileRejectionInfo[] = [];
  const reasons = new Set<FileRejection>();

  const reject = (file: File, reason: FileRejection): void => {
    reasons.add(reason);
    rejections.push({ file, reason, message: REJECTION_MESSAGES[reason] });
  };

  for (const file of files ?? []) {
    if (!file || typeof file.size !== 'number') {
      continue;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      reject(file, 'size');
      continue;
    }
    if (accepted.length >= IMAGE_MAX_FILES_PER_ADD) {
      reject(file, 'count');
      continue;
    }
    if (sniffImageType(await headOf(file)) === null) {
      reject(file, 'type');
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections, reasons };
}
