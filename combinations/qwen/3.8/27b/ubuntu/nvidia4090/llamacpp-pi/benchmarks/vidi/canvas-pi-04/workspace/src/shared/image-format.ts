// Story 12: image type sniffing and asset keys (anchor: assets.api).
//
// Pure, client-/server-shared helpers with no runtime dependencies:
//  - `sniffImageType` decides the image type from the file's LEADING BYTES
//    (magic bytes), never from the client-supplied Content-Type, so a renamed
//    PDF or an SVG with a script can never be stored as an image (image.types).
//  - `ASSET_KEY_PATTERN` / `assetKeyFor` shape the unguessable storage key
//    `<boardId>/<assetId>`; both ids are 22-char base64url (story 5's
//    `newBoardId`), so a key is only guessable if both random ids are.
//
// Keeping this pure (no worker imports) lets the node-environment unit tests
// and the client both use it.

import { BOARD_ID_PATTERN } from './board-id';
import type { AcceptedImageType } from './config';

/**
 * Decide the image type from the first bytes of a file, or null when the head
 * does not match any accepted raster signature. Only the raster types from
 * {@link IMAGE_ACCEPTED_TYPES} are accepted; anything else (SVG, PDF, HEIC,
 * video, ...) returns null (image.types).
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head === null || head === undefined) return null;
  const b = (i: number): number => (i < head.length ? head[i]! : -1);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" or "GIF89a" (47 49 46 38 37 61 / 47 49 46 38 39 61)
  if (
    b(0) === 0x47 &&
    b(1) === 0x49 &&
    b(2) === 0x46 &&
    b(3) === 0x38 &&
    (b(4) === 0x37 || b(4) === 0x39) &&
    b(5) === 0x61
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF" .... "WEBP" (52 49 46 46 .. 57 45 42 50 at offset 8)
  if (
    b(0) === 0x52 &&
    b(1) === 0x49 &&
    b(2) === 0x46 &&
    b(3) === 0x46 &&
    b(8) === 0x57 &&
    b(9) === 0x45 &&
    b(10) === 0x42 &&
    b(11) === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * A valid asset key: two 22-char base64url ids joined by a single `/`
 * (`<boardId>/<assetId>`). Reuses the board-id charset/length so the two
 * halves are exactly what `newBoardId()` produces.
 */
export const ASSET_KEY_PATTERN: RegExp = new RegExp(
  `^(${BOARD_ID_PATTERN.source.slice(1, -1)})/(${BOARD_ID_PATTERN.source.slice(1, -1)})$`,
);

/** The storage key for one asset under a board: `<boardId>/<assetId>`. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
