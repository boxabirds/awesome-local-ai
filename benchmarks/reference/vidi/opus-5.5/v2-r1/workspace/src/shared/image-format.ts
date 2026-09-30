// Image type sniffing and asset keys (story 12). Shared by the Worker (upload decisions) and the
// client (image addresses). Framework-free.
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The image type of a file from its first bytes (magic numbers), or null when it is not one of
 * IMAGE_ACCEPTED_TYPES. Only the first IMAGE_SNIFF_BYTES are looked at; names and declared
 * content types never matter. SVG (text) is never accepted.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const h = head.subarray(0, IMAGE_SNIFF_BYTES);
  if (startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(h, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(h, ascii('GIF87a')) || startsWith(h, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** `<boardId>/<assetId>`: two 22-character base64url ids (story 5's 128-bit ids). */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Where the board page loads a stored image from. */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}
