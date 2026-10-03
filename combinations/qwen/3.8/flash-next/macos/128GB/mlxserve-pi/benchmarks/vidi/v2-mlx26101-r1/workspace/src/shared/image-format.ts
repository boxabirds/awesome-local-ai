// What kind of image is this? Magic bytes are the authority, never the filename.
//
// A `.png` that is really a PDF is the case the PRD calls out, and the only way to catch it is to
// read the front of the file. This is deliberately a tiny pile of byte comparisons with no
// dependency in it: the Worker runs it on an uploaded body, the shared model layer can use it in a
// test, and neither has to trust a name someone typed.

import { IMAGE_ACCEPTED_TYPES, type AcceptedImageType } from './config.js';
import { newBoardId } from './board-id.js';

export type { AcceptedImageType };

/**
 * Compare the leading bytes of a file against the signatures of the accepted types. Returns the
 * IANA media type, or null for anything else — including a file whose name ends in `.png`.
 *
 * A short file is fine: the head is only compared as far as it goes.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const starts = (bytes: readonly number[], offset = 0): boolean => {
    if (head.length < offset + bytes.length) return false;
    for (let i = 0; i < bytes.length; i += 1) {
      if (head[offset + i] !== bytes[i]) return false;
    }
    return true;
  };
  const accepted = (type: AcceptedImageType): boolean =>
    (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);

  // PNG: 0x89 'P' 'N' 'G' 0x0D 0x0A 0x1A 0x0A.
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return accepted('image/png') ? 'image/png' : null;
  }
  // JPEG: 0xFF 0xD8 0xFF.
  if (starts([0xff, 0xd8, 0xff])) {
    return accepted('image/jpeg') ? 'image/jpeg' : null;
  }
  // GIF: 'GIF87a' or 'GIF89a'. The two versions are the only ones that exist, and the version
  // bytes are part of the signature — a file that starts 'GIF88a' is not a GIF a browser can read.
  if (starts([0x47, 0x49, 0x46]) && head[3] === 0x38 && head[5] === 0x61) {
    const version = String.fromCharCode(head[3], head[4], head[5]);
    if ((version === '87a' || version === '89a') && accepted('image/gif')) return 'image/gif';
    return null;
  }
  // WebP: 'RIFF' <4 size bytes> 'WEBP'. The size is skipped because it is not part of the shape.
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return accepted('image/webp') ? 'image/webp' : null;
  }
  return null;
}

/**
 * An asset key as text: `<boardId>/<assetId>`, both 22-character ids. The key doubles as the R2
 * object key and the public path, so the shape is checked before it is used for anything.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Does this string look like an asset key? */
export function isAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}

/**
 * A fresh asset id: the same 128 bits, the same alphabet and the same generator as a board id — not a
 * second implementation of "22 unguessable characters", because a key is only as hard to guess as its
 * hardest half and both halves are made here.
 */
export function newAssetId(): string {
  return newBoardId();
}

/**
 * The key an uploaded image is stored under. The board id is part of it, which is what makes a
 * read checkable without a lookup table: an image belongs to the board whose id is in its key.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Which board an asset key belongs to. */
export function boardIdOfAssetKey(key: string): string {
  return key.slice(0, key.indexOf('/'));
}
