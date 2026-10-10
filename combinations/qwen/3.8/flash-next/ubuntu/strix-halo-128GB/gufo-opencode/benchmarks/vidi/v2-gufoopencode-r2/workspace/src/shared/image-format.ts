// Story 12: raster image type sniffing (magic bytes only, never names or
// Content-Type) and unguessable asset keys (`<boardId>/<assetId>`, both
// 128-bit base64url ids from story 5).

import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(head: Uint8Array, text: string, offset = 0): boolean {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i));
  return startsWith(head, bytes, offset);
}

// PNG 89 50 4E 47, JPEG FF D8 FF, GIF87a/GIF89a, WebP RIFF....WEBP.
// Anything else (SVG text, a renamed PDF, random bytes) is null: only these
// four raster formats may be stored or served.
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(head, 'GIF87a') || ascii(head, 'GIF89a')) return 'image/gif';
  if (ascii(head, 'RIFF') && ascii(head, 'WEBP', 8)) return 'image/webp';
  return null;
}
