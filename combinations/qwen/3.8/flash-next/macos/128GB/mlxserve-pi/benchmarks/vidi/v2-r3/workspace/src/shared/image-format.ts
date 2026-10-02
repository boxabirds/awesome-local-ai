/*! Image format sniffing and asset keys (story 12).
 *
 * The board believes what a file's *bytes* say it is, never what it is called
 * (image.formats): a PDF renamed `.png` has `%PDF` where a PNG has its
 * `‰PNG`, and that is the whole of the test. This module is deliberately pure
 * — no files, no network, no DOM — because the same twelve bytes have to give
 * the same answer in a browser, in a Worker and in a unit test.
 *
 * The signatures are the first bytes each format's specification fixes:
 *
 *   PNG     89 50 4E 47 0D 0A 1A 0A   (`‰PNG` then the DOS/CRLF pair)
 *   JPEG    FF D8 FF                 (start of image, first marker)
 *   GIF     47 49 46 38 37 61 / 38 39 61   (`GIF87a` or `GIF89a`)
 *   WebP    52 49 46 46 … 57 45 42 50     (`RIFF` at 0, `WEBP` at 8)
 *
 * Only the part of a signature which identifies the format is required: PNG is
 * checked over its first four bytes rather than all eight, so a file truncated
 * before its terminator still says what it is (TC-08) instead of becoming an
 * unknown format because the tail is missing.
 */
import { BOARD_ID_PATTERN } from './board-id';
import { IMAGE_ACCEPTED_TYPES, type ImageFormat } from './config';

export type { ImageFormat };

/** The formats {@link sniffImageType} can name. */
export type AcceptedImageType = ImageFormat;

const ASCII = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

const PNG: number[] = [0x89, 0x50, 0x4e, 0x47];
const JPEG: number[] = [0xff, 0xd8, 0xff];
const GIF_87: number[] = [...ASCII('GIF87'), 0x61];
const GIF_89: number[] = [...ASCII('GIF89'), 0x61];
const RIFF: number[] = ASCII('RIFF');
const WEBP: number[] = ASCII('WEBP');

/** Does `head` start with `bytes`? A head shorter than the signature never matches. */
function startsWith(head: Uint8Array, bytes: readonly number[], at = 0): boolean {
  if (at + bytes.length > head.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[at + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * What these bytes are, or `null` when they are not an image the board keeps.
 *
 * `head` is the beginning of a file — up to {@link IMAGE_SNIFF_BYTES} bytes is
 * enough, and anything shorter is sniffed as far as it goes. The answer decides
 * the `Content-Type` the bytes are stored under, so what a browser is later
 * served is what the bytes actually are: an SVG is not sniffed, and so is never
 * served back as something an `<img>` would paint.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, PNG)) return 'image/png';
  if (startsWith(head, JPEG)) return 'image/jpeg';
  if (startsWith(head, GIF_87) || startsWith(head, GIF_89)) return 'image/gif';
  if (startsWith(head, RIFF, 0) && startsWith(head, WEBP, 8)) return 'image/webp';
  return null;
}

/** Is this string one of the formats the board accepts? */
export function isImageFormat(value: unknown): value is AcceptedImageType {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(value as string);
}

/** One id inside an asset key: the very thing `BOARD_ID_PATTERN` matches, with its
 * anchors taken off so it can be used twice. Single-sourced on purpose — a key is
 * two board-shaped ids, and if an id ever changes length the pattern below changes
 * with it rather than quietly stopping to match anything real. */
const KEY_ID = BOARD_ID_PATTERN.source.slice(1, -1);

/**
 * The shape of an asset key: `<board id>/<asset id>`, both base64url ids of the
 * length the board's ids are (TC-02).
 *
 * This is the worker's only defence on the asset route, and it is a strict one:
 * the two characters `..` are not in either part, so a key cannot name another
 * board's bytes, climb out of a prefix, or contain a path separator at all.
 */
export const ASSET_KEY_PATTERN = new RegExp(`^${KEY_ID}\\/${KEY_ID}$`);

/**
 * The key the bytes of image `assetId` on board `boardId` are stored under.
 *
 * Board first, so every byte of one board sits under one prefix (design: assets
 * are keyed `<boardId>/<assetId>`, not by the client-supplied filename, which is
 * text the board is told and cannot check).
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** The board part of a key, or `null` when the key is not a key at all. */
export function boardIdOfKey(key: string): string | null {
  if (!ASSET_KEY_PATTERN.test(key)) return null;
  return key.slice(0, key.indexOf('/'));
}
