// Image type detection from content (magic bytes) and stored-asset keys (story 12). Framework-free: the Worker
// uses it to decide what it stores and serves, tests use it directly.
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The accepted image type the first bytes of a file show it to be (only the first IMAGE_SNIFF_BYTES are looked
 * at), or null for anything else: SVG, PDF, other formats, too few bytes. The file's name or declared type never
 * matter.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const h = head.subarray(0, IMAGE_SNIFF_BYTES);
  if (startsWith(h, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(h, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(h, ascii('GIF87a')) || startsWith(h, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** `<boardId>/<assetId>`, both 22-character base64url ids (128 bits, like board ids). */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Where the board page loads a stored image from. */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}
