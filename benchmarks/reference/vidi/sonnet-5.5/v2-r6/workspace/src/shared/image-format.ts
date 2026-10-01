import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

const startsWith = (head: Uint8Array, at: number, bytes: readonly number[]): boolean =>
  head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** The image type judged by magic bytes only (never by name or declared type); null for anything else. */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(head, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, 0, ascii('GIF87a')) || startsWith(head, 0, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(head, 0, ascii('RIFF')) && startsWith(head, 8, ascii('WEBP'))) return 'image/webp';
  return null;
}

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
