// Image type sniffing and asset keys (story 12, assets.api). Shared by the
// Worker (upload decisions) and the client (refusing files before upload).
import { BOARD_ID_PATTERN } from './board-id';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87A = [...'GIF87a'].map((c) => c.charCodeAt(0));
const GIF89A = [...'GIF89a'].map((c) => c.charCodeAt(0));
const RIFF = [...'RIFF'].map((c) => c.charCodeAt(0));
const WEBP = [...'WEBP'].map((c) => c.charCodeAt(0));
const WEBP_OFFSET = 8;

function startsWith(head: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  return sig.every((b, i) => head[offset + i] === b);
}

/**
 * The image type from its first IMAGE_SNIFF_BYTES bytes (magic bytes only;
 * never the file name or a declared Content-Type), or null for anything else,
 * including SVG and disguised files.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const h = head.subarray(0, IMAGE_SNIFF_BYTES);
  if (startsWith(h, PNG)) return 'image/png';
  if (startsWith(h, JPEG)) return 'image/jpeg';
  if (startsWith(h, GIF87A) || startsWith(h, GIF89A)) return 'image/gif';
  if (startsWith(h, RIFF) && startsWith(h, WEBP, WEBP_OFFSET)) return 'image/webp';
  return null;
}

/** `<boardId>/<assetId>`, both 22-character base64url ids (128 bits, story 5). */
export const ASSET_KEY_PATTERN = new RegExp(
  `^${BOARD_ID_PATTERN.source.slice(1, -1)}/${BOARD_ID_PATTERN.source.slice(1, -1)}$`,
);

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

export function isAssetKey(key: unknown): key is string {
  return typeof key === 'string' && ASSET_KEY_PATTERN.test(key);
}

/** Where the board page (and later board export) loads a stored image from. */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}
