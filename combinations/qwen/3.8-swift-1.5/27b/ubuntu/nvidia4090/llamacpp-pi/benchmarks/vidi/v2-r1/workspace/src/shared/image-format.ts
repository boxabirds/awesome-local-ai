/**
 * Story 12: shared image-format helpers (assets.api).
 *
 * Magic-byte sniffing decides the stored content type from the file's
 * CONTENT, never its name or the request's Content-Type (PRD image.types).
 * A renamed PDF or an SVG (which can carry scripts) is refused with 415
 * and nothing is stored.
 *
 * Asset keys are `<boardId>/<assetId>` where both ids are 22-char base64url
 * (story 5 `newBoardId`, 128 bits), so keys are unguessable and path-safe.
 */
import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];            // 89 50 4E 47
const JPEG_MAGIC = [0xff, 0xd8, 0xff];                  // FF D8 FF
const GIF_PREFIX = [0x47, 0x49, 0x46, 0x38];            // "GIF8"
const GIF_SUFFIX_7 = 0x37;                              // "7" (GIF87a)
const GIF_SUFFIX_9 = 0x39;                              // "9" (GIF89a)
const GIF_A = 0x61;                                     // "a"
const RIFF = [0x52, 0x49, 0x46, 0x46];                  // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50];                  // "WEBP" (bytes 8-11)

function startsWith(head: Uint8Array, magic: readonly number[]): boolean {
  if (head.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (head[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Sniff the image type from the first bytes of a file (at most
 * IMAGE_SNIFF_BYTES are needed; callers may pass a longer head).
 * Returns null for anything that is not PNG, JPEG, GIF87a/GIF89a or WebP.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, PNG_MAGIC)) return 'image/png';
  if (startsWith(head, JPEG_MAGIC)) return 'image/jpeg';
  if (
    head.length >= 6 &&
    startsWith(head, GIF_PREFIX) &&
    (head[4] === GIF_SUFFIX_7 || head[4] === GIF_SUFFIX_9) &&
    head[5] === GIF_A
  ) {
    return 'image/gif';
  }
  if (head.length >= 12 && startsWith(head, RIFF) && startsWith(head.subarray(8), WEBP)) {
    return 'image/webp';
  }
  return null;
}

/** `<boardId>/<assetId>` with both ids matching story 5's board-id pattern. */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build the storage key for an asset of a board. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
