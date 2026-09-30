// Image type detection by content (magic bytes) and stored asset keys (story 12).
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** `<boardId>/<assetId>`: two 128-bit base64url ids (story 5 format). Nothing else is ever served. */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The accepted image type of a file from its first IMAGE_SNIFF_BYTES bytes, or
 * null. Only the content decides: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`,
 * `GIF87a`/`GIF89a`, WebP `RIFF....WEBP`. SVG (text) and anything else → null.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const h = head.subarray(0, IMAGE_SNIFF_BYTES);
  if (startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(h, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(h, ascii('GIF87a')) || startsWith(h, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

export function isAcceptedImageType(type: string): type is AcceptedImageType {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Address the board page loads a stored image from (also used by board export, story 17). */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}
