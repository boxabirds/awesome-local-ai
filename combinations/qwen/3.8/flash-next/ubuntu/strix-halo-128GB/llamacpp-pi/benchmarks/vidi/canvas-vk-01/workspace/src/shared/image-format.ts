import { IMAGE_ACCEPTED_TYPES, type AcceptedImageType } from './config';

/**
 * Deciding what an uploaded file *is*, from its bytes alone (`image.types`).
 *
 * The client's `File.type` comes from the extension and is trivially wrong, so
 * the Worker never trusts it: it reads the leading bytes and matches them
 * against the signatures of the accepted formats. Anything else — SVG (which can
 * carry scripts), a PDF renamed `.png` — is refused before a single byte reaches
 * storage, and nothing is ever asked to decode the body.
 *
 * Framework-free: the Worker, the client and the tests import the same rules.
 */

export type { AcceptedImageType };

const ACCEPTED: ReadonlySet<string> = new Set<string>(IMAGE_ACCEPTED_TYPES);

// The signatures of the accepted formats, as the first bytes of a file. A PNG
// signature includes a CR and a sub-EOF byte that no text file produces, so a
// mis-labelled or half-written file cannot pass by accident.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const GIF_87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const;
const GIF_89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;

export function isAcceptedImageType(value: unknown): value is AcceptedImageType {
  return typeof value === 'string' && ACCEPTED.has(value);
}

/**
 * An asset key is `<boardId>/<assetId>`: two 22-character base64url ids — the
 * board's and the asset's, both 128 bits of randomness (story 5) — joined by one
 * slash. Nothing else is a valid key, which is what keeps `..`-style paths out
 * of storage (`image.sniff`) — the asset route matches a request path against
 * this before touching the bucket.
 */
export const ASSET_KEY_PATTERN: RegExp = new RegExp(
  String.raw`^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$`,
);

const ID_SEGMENT = String.raw`[A-Za-z0-9_-]{22}`;
const ID_PATTERN: RegExp = new RegExp(`^${ID_SEGMENT}$`);

/** 16 random bytes as 22 base64url characters, without padding. */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** A new asset id: 22 base64url characters, so an asset URL cannot be walked. */
export function newAssetId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/**
 * The R2 key of an asset, from its board id and asset id. Both must already be
 * ids of the shape the API mints: a caller holding `../..` or an extra path
 * segment is refused here rather than at the bucket.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  if (!ID_PATTERN.test(boardId)) throw new Error(`assetKeyFor: "${boardId}" is not a 22-character id`);
  if (!ID_PATTERN.test(assetId)) throw new Error(`assetKeyFor: "${assetId}" is not a 22-character id`);
  return `${boardId}/${assetId}`;
}

/**
 * The MIME type of an image judged from its content, or null when the content is
 * not an accepted image type (`image.types`).
 *
 * Only the signature is read, so a disguised file is refused without anything
 * ever being asked to decode it, and a file whose signature is right is accepted
 * whatever it was named. WebP needs both `RIFF` and, four bytes later, `WEBP`, so
 * any other RIFF container (WAV, AVI) is refused.
 */
export function sniffImageType(head: Uint8Array | ArrayBuffer): AcceptedImageType | null {
  const view = head instanceof Uint8Array ? head : new Uint8Array(head);
  const starts = (offset: number, signature: readonly number[]): boolean => {
    if (view.length < offset + signature.length) return false;
    for (let index = 0; index < signature.length; index += 1) {
      if (view[offset + index] !== signature[index]) return false;
    }
    return true;
  };
  if (starts(0, PNG_SIGNATURE)) return 'image/png';
  if (starts(0, JPEG_SIGNATURE)) return 'image/jpeg';
  if (starts(0, GIF_87A) || starts(0, GIF_89A)) return 'image/gif';
  if (starts(0, RIFF) && starts(8, WEBP)) return 'image/webp';
  return null;
}
