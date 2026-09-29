/**
 * Image format sniffing and asset keys (story 12, assets.api).
 *
 * The worker decides an upload's type from its *content*, never from the
 * client's `Content-Type` header: a stored file must be what it claims to be so
 * it can be served with a trustworthy `Content-Type` and never executed.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

/** Raster image types accepted by the board. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

const ACCEPTED: ReadonlySet<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

/** True when `head` starts with `bytes`. */
function startsWith(head: Uint8Array, bytes: readonly number[]): boolean {
  if (head.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[i] !== bytes[i]) return false;
  }
  return true;
}

/** ASCII compare helper for container signatures (`RIFF`, `WEBP`). */
function ascii(head: Uint8Array, offset: number, text: string): boolean {
  if (head.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (head[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Identify an image from its first bytes.
 *
 * PNG `89 50 4E 47`, JPEG `FF D8 FF`, `GIF87a`/`GIF89a`, WebP `RIFF….WEBP`.
 * Everything else — SVG text, a PDF renamed `.png`, truncated or random data —
 * returns null, so the caller can refuse it.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return 'image/gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'image/webp';
  return null;
}

/**
 * Stored asset keys are `<boardId>/<assetId>`; both halves are story-5 ids
 * (22 URL-safe characters, 128 bits), so a key cannot be guessed or enumerated
 * and `..` can never escape the bucket prefix.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build the R2 key for an asset belonging to a board. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** `<boardId>/<assetId>` from `GET /api/assets/:boardId/:assetId`. */
export function assetKeyFromPath(boardId: string, assetId: string): string {
  return assetKeyFor(boardId, assetId);
}

/** Is this MIME type one of the accepted raster types? */
export function isAcceptedImageType(value: string): value is AcceptedImageType {
  return ACCEPTED.has(value);
}

/**
 * Number of leading bytes needed to decide a type. Callers may send fewer for
 * tiny files; `sniffImageType` handles short input.
 */
export const SNIFF_WINDOW_BYTES = IMAGE_SNIFF_BYTES;
