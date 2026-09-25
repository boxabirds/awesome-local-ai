/**
 * Image type sniffing and asset keys (story 12), shared by the Worker (upload and serve) and the
 * client (image URLs).
 *
 * The type of an uploaded file is decided from its first bytes only, never from its name or the
 * client's Content-Type header (image.types). Only raster types are recognised: SVG (which can
 * carry scripts) and everything else is refused.
 *
 * Asset keys are `<boardId>/<assetId>`, both 128-bit base64url ids (story 5's newBoardId), so a
 * stored image's address is as hard to guess as the board's link.
 */
import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** `<22-char board id>/<22-char asset id>`: nothing else (no dots, slashes or other lengths). */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Where the client fetches a stored image (GET route of the asset API). */
export const ASSETS_URL_PREFIX = '/api/assets/';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
/** "GIF87a" and "GIF89a". */
const GIF_SIGNATURES = [
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
] as const;
/** "RIFF" at 0 and "WEBP" at WEBP_TAG_OFFSET. */
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const;
const WEBP_TAG_OFFSET = 8;

function startsWith(head: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  return sig.every((byte, i) => head[offset + i] === byte);
}

/** The accepted image type whose signature `head` (the file's first bytes) starts with, or null. */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(head, JPEG_SIGNATURE)) return 'image/jpeg';
  if (GIF_SIGNATURES.some((sig) => startsWith(head, sig))) return 'image/gif';
  if (startsWith(head, RIFF_SIGNATURE) && startsWith(head, WEBP_TAG, WEBP_TAG_OFFSET)) return 'image/webp';
  return null;
}

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

export function isAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}

/** The URL an image object's stored file is served from. */
export function assetUrl(assetKey: string): string {
  return `${ASSETS_URL_PREFIX}${assetKey}`;
}
