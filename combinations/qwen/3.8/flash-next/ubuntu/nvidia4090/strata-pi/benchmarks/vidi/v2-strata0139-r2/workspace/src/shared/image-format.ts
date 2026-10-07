/**
 * `assets.api` — deciding what an image is, from its bytes.
 *
 * Two rules hold this story together:
 *
 *   - a file is an accepted image only if its **content** says so. The browser
 *     checks `File.type` and then actually decodes the file; the Worker looks at
 *     nothing but the first `IMAGE_SNIFF_BYTES` bytes of the body and never at a
 *     name or a `Content-Type`. A PDF renamed `.png` is refused by both.
 *   - an asset key is `<boardId>/<assetId>`, both halves 128 bits of randomness
 *     in the same base64url alphabet story 5 uses for board links, so a stored
 *     image is as unguessable as the board it belongs to.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from "./config";
import { BOARD_ID_PATTERN } from "./board-id";

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * `<boardId>/<assetId>` — the same 22 base64url characters `BOARD_ID_PATTERN`
 * accepts, twice. Written out rather than built from `BOARD_ID_PATTERN.source`,
 * which carries its own anchors.
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** PNG: the whole 8-byte signature — a file cut off inside it is not a PNG. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** JPEG: `FF D8 FF`. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
/** GIF87a and GIF89a, as ASCII. */
const GIF_MAGICS = ["GIF87a", "GIF89a"];
/** WebP: `RIFF` … `WEBP` — the size field in between is free. */
const RIFF_MAGIC = "RIFF";
const WEBP_MAGIC = "WEBP";

/**
 * The image type a body of bytes is, or `null` for anything this board will not
 * store. Only the first `IMAGE_SNIFF_BYTES` bytes are looked at, which is enough
 * for all four formats and too little for anything to hide behind.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (!head || head.length === 0) return null;
  const bytes = head.subarray(0, IMAGE_SNIFF_BYTES);

  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";

  const text = ascii(bytes);
  if (GIF_MAGICS.some((magic) => text.startsWith(magic))) return "image/gif";
  if (text.startsWith(RIFF_MAGIC) && text.slice(8, 12) === WEBP_MAGIC) return "image/webp";

  return null;
}

/** The key an asset with this id is stored under. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** The alphabet a board id and an asset id are both written in. */
export const ASSET_ID_PATTERN: RegExp = new RegExp(BOARD_ID_PATTERN.source);

/** The board half of a key, or `null` when the key is not a key at all. */
export function boardIdOfKey(key: string): string | null {
  if (typeof key !== "string" || !ASSET_KEY_PATTERN.test(key)) return null;
  return key.slice(0, 22);
}

/** True when `key` is a well-formed asset key. */
export function isAssetKey(key: string): boolean {
  return typeof key === "string" && ASSET_KEY_PATTERN.test(key);
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[index] !== magic[index]) return false;
  }
  return true;
}

/** The bytes as the Latin-1 text their magic signatures are written in. */
function ascii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}
