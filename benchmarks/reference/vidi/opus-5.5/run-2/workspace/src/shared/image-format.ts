/**
 * Image type recognition and stored-image keys (anchor: assets.api). Shared by the Worker
 * (upload sniffing, key validation) and the client (image addresses).
 *
 * The type is decided from the leading bytes only, never from a file name or a client
 * header: PNG `89 50 4E 47`, JPEG `FF D8 FF`, `GIF87a` / `GIF89a`, WebP `RIFF....WEBP`.
 * Everything else, SVG included, is not an accepted image.
 */
import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // GIF87a
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
/** "WEBP" follows the 4-byte RIFF tag and the 4-byte chunk size. */
const WEBP_OFFSET = 8;

function startsWith(head: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (head.length < offset + magic.length) return false;
  return magic.every((b, i) => head[offset + i] === b);
}

/** The accepted image type these leading bytes belong to, or null. */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, PNG)) return 'image/png';
  if (startsWith(head, JPEG)) return 'image/jpeg';
  if (startsWith(head, GIF87) || startsWith(head, GIF89)) return 'image/gif';
  if (startsWith(head, RIFF) && startsWith(head, WEBP, WEBP_OFFSET)) return 'image/webp';
  return null;
}

export function isAcceptedImageType(type: string): type is AcceptedImageType {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/** `<boardId>/<assetId>`, both 128-bit base64url ids (story 5 `newBoardId()`). */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Where the board page loads a stored image from (GET /api/assets/:boardId/:assetId). */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}
