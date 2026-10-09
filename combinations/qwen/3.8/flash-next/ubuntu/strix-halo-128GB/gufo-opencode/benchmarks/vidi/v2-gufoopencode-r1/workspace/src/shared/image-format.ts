import { IMAGE_ACCEPTED_TYPES } from './config';

// Story 12: magic-byte image type detection and unguessable asset keys.
// The server decides the type from the first IMAGE_SNIFF_BYTES of the body
// only, never from the file name or Content-Type (design assets.api).

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

// `<22-char board id>/<22-char asset id>`; both parts come from story 5's
// base64url ids (128 bits), so keys are as unguessable as board links.
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

function startsWith(head: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (head.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (head[offset + i] !== magic[i]) return false;
  }
  return true;
}

export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, PNG_MAGIC)) return 'image/png';
  if (startsWith(head, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(head, GIF87A) || startsWith(head, GIF89A)) return 'image/gif';
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'image/webp';
  return null;
}

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
