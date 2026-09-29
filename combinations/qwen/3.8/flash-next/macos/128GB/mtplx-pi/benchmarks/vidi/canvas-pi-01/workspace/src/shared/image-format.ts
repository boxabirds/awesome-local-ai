/**
 * Story 12 · image format sniffing and asset keys (design "Asset upload and
 * serving API", `assets.api`).
 *
 * A file's type is decided from its **content**, never from a client-supplied
 * header or a file name (PRD image.types). This module reads only the first
 * {@link IMAGE_SNIFF_BYTES} magic bytes and returns the accepted MIME type, or
 * `null` for anything that is not one of the four supported raster formats.
 * SVG is deliberately rejected: it can carry scripts, so it is never served as
 * an image (PRD Security).
 *
 * Asset keys are `<boardId>/<assetId>`, both 22-character URL-safe ids built by
 * `newBoardId()` (128 bits), so a stored address is as unguessable as a board
 * link (PRD Security, story 5). {@link ASSET_KEY_PATTERN} is the single rule a
 * serve request is checked against; anything that fails it is a 404 without ever
 * touching the bucket.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

/** One of the four accepted image MIME types. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * The two-byte / four-byte magic prefixes of the supported formats. A PNG
 * begins `89 50 4E 47`; a JPEG `FF D8 FF`; a GIF `GIF87a` or `GIF89a`; a WebP
 * is a `RIFF` container whose bytes 8..11 read `WEBP`.
 */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF_A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF_B = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function startsWith(head: Uint8Array, offset: number, magic: readonly number[]): boolean {
  if (head.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (head[offset + i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Decide the accepted image type from the leading bytes. Only the first
 * {@link IMAGE_SNIFF_BYTES} bytes are consulted (a WebP needs all twelve to see
 * the `WEBP` tag); a shorter or unrecognised head is `null`. The input is read
 * but never mutated.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  // Only the sniff window matters; ignore any trailing bytes the caller passed.
  const window = head.length > IMAGE_SNIFF_BYTES ? head.subarray(0, IMAGE_SNIFF_BYTES) : head;
  if (startsWith(window, 0, PNG_MAGIC)) return 'image/png';
  if (startsWith(window, 0, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(window, 0, GIF_A) || startsWith(window, 0, GIF_B)) return 'image/gif';
  // WebP: `RIFF` at 0, the four-byte length at 4..7, then `WEBP` at 8..11.
  if (startsWith(window, 0, RIFF) && startsWith(window, 8, WEBP)) return 'image/webp';
  return null;
}

/**
 * A valid asset key: `<22 url-safe chars>/<22 url-safe chars>`. The two ids are
 * the board's and the asset's, each built by `newBoardId()`; the pattern is
 * what stops a serve request from escaping its board (`../`) or probing a
 * malformed key, so a failed match is answered `404` with no bucket read.
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Assemble the R2 key for one board's asset. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
