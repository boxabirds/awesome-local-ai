/**
 * Magic-byte image type sniffing and asset key helpers (story 12, assets.api).
 *
 * The server decides an upload's type from its leading bytes only (never the
 * file name or Content-Type), so a renamed PDF or an SVG is refused. Asset
 * keys are `<boardId>/<assetId>` where both parts are 22-char base64url ids
 * (story 5), so they are unguessable.
 */

import { IMAGE_ACCEPTED_TYPES, type ImageAcceptedType } from './config';
import { BOARD_ID_PATTERN } from './board-id';

/** A raster content type the board accepts. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number] & ImageAcceptedType;

/**
 * Sniff an image's content type from its leading bytes.
 *
 * - PNG:  `89 50 4E 47`
 * - JPEG: `FF D8 FF`
 * - GIF:  `GIF87a` / `GIF89a`
 * - WebP: `RIFF` .... `WEBP` (bytes 0-3 and 8-11)
 *
 * Anything else (SVG text, PDF, video, random bytes, too-short) → null.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (!head || head.length < 4) return null;
  // PNG
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  // JPEG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF87a / GIF89a ("GIF8" + version "7a"/"9a")
  if (
    head[0] === 0x47 && // G
    head[1] === 0x49 && // I
    head[2] === 0x46 && // F
    head[3] === 0x38 && // 8
    (head[4] === 0x37 || head[4] === 0x39) && // 7 / 9
    head[5] === 0x61 // a
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF"...."WEBP"
  if (head.length >= 12) {
    const riff =
      head[0] === 0x52 && // R
      head[1] === 0x49 && // I
      head[2] === 0x46 && // F
      head[3] === 0x46; // F
    const webp =
      head[8] === 0x57 && // W
      head[9] === 0x45 && // E
      head[10] === 0x42 && // B
      head[11] === 0x50; // P
    if (riff && webp) return 'image/webp';
  }
  return null;
}

/**
 * A well-formed asset key: `<22-char id>/<22-char id>`.
 * Both parts must be exactly 22 base64url characters (no slashes, dots, etc.).
 */
export const ASSET_KEY_PATTERN: RegExp = new RegExp(
  `^${BOARD_ID_PATTERN.source.slice(1, -1)}/${BOARD_ID_PATTERN.source.slice(1, -1)}$`,
);

/**
 * Build an asset key from a board id and an asset id.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
