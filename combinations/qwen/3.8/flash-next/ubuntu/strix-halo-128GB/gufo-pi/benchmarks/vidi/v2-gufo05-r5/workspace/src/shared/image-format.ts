/**
 * Image file formats and asset keys (story 12).
 *
 * A file's type is decided by its *content*, never by its name or by a `Content-Type` header: a
 * renamed PDF and an SVG carrying a script must both be refused. The magic bytes of the four
 * accepted formats are all decided within the first `IMAGE_SNIFF_BYTES` bytes of the file, which
 * is why a caller may hand a prefix rather than the whole body.
 *
 * An asset key is `<boardId>/<assetId>`, both halves a 22-character base64url address (story 5),
 * so a stored image is as unguessable as the board it belongs to. The pattern is a whole-string
 * match, so `../`, a missing half or an over-long id all fail before anything is read from storage.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

/** One of the four media types this build accepts. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** The four accepted media types, for a caller that checks membership. */
export const ACCEPTED_IMAGE_TYPES: readonly AcceptedImageType[] = IMAGE_ACCEPTED_TYPES;

/**
 * The image type whose magic bytes open `head`, or `null` when no accepted format does.
 *
 * A prefix shorter than the signature simply answers `null`; nothing is guessed from the rest of a
 * file, and anything that is not PNG, JPEG, GIF or WebP - an SVG, a PDF renamed `.png`, three
 * random bytes - is refused.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const at = (index: number): number => (index < head.length ? head[index]! : -1);

  // PNG: 89 50 4E 47 (.PNG), the first four of its 8-byte signature.
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';

  // JPEG: FF D8 FF.
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';

  // GIF: "GIF87a" or "GIF89a" (the version digits differ; both are the GIF format).
  if (
    at(0) === 0x47 && // G
    at(1) === 0x49 && // I
    at(2) === 0x46 && // F
    at(3) === 0x38 && // 8
    (at(4) === 0x37 || at(4) === 0x39) && // 7 or 9
    at(5) === 0x61 // a
  ) {
    return 'image/gif';
  }

  // WebP: "RIFF" <4 size bytes> "WEBP" - the whole thing fits in IMAGE_SNIFF_BYTES.
  if (
    at(0) === 0x52 && // R
    at(1) === 0x49 && // I
    at(2) === 0x46 && // F
    at(3) === 0x46 && // F
    at(8) === 0x57 && // W
    at(9) === 0x45 && // E
    at(10) === 0x42 && // B
    at(11) === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * The shape of a stored image's key: two base64url board-style addresses separated by one slash.
 * Whole-string, so path traversal and a half-shaped key never reach storage.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** The R2 key under which an image uploaded to `boardId` lives. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** How many leading bytes of a file `sniffImageType` needs at most. */
export const SNIFF_HEAD_BYTES = IMAGE_SNIFF_BYTES;
