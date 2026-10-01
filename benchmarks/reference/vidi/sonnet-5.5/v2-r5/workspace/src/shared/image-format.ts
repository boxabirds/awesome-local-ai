import type { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

const startsWith = (head: Uint8Array, bytes: readonly number[], at = 0) =>
  head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Decides the type from magic bytes only (never from a name or declared Content-Type). */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
