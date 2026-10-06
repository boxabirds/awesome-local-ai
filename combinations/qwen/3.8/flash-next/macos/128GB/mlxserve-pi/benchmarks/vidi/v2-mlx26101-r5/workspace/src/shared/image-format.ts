/**
 * What a file *is*, read out of its bytes, and where its bytes live.
 *
 * Two facts, both of which had to live somewhere both sides of the network could reach:
 *
 * - **The type.** A file's name is a claim and its `Content-Type` is a claim, and either can be — and in
 *   this story's own test fixtures, is — a lie: a PDF renamed to `.png` says `image/png` to the browser and
 *   to the server. The bytes at the front of a file are not a claim. So the whole of "which of these four
 *   formats" is answered here, from the first {@link IMAGE_SNIFF_BYTES} bytes, by the Worker that decides
 *   whether to store a file and by nothing else. An SVG is refused here as well: an SVG is XML and can
 *   carry a script, which is why the PRD says raster formats only and why a file that begins `<` matches
 *   no signature below.
 * - **The key.** A stored image is addressed by `<boardId>/<assetId>`, and the second half of that
 *   pair is the only secret there is — there is no sign-in on this board, so "you would have to know to
 *   ask" is the whole of the access control, which is the same promise story 5 makes about board links.
 *   That is why {@link ASSET_KEY_PATTERN} insists on two exactly-22-character base64url parts: an id
 *   generated anywhere else is a different length, and a key that does not match the pattern is refused
 *   before the bucket is ever asked, so `../x` and its friends cannot name anything at all.
 *
 * This module is shared, and has to stay that way: no `File`, no `Response`, no `R2`. It runs in workerd,
 * in the browser and in a unit test that has neither.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

/** One of the four formats this board accepts, as its MIME type. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** The four types, so a caller does not have to write them out to ask a question about them. */
export const ACCEPTED_IMAGE_TYPES: readonly AcceptedImageType[] = IMAGE_ACCEPTED_TYPES;

/** Is this string one of the four? (`validateFiles` asks; the sniffer answers with them.) */
export function isAcceptedImageType(value: unknown): value is AcceptedImageType {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(String(value));
}

/**
 * The shape of a stored asset's key: two ids of the kind story 5 generates, joined by one slash.
 *
 * 22 characters is what 128 bits of randomness looks like in base64url without padding, which is what
 * `newBoardId()` returns — an asset id *is* a board-shaped id, and that is not a coincidence: both are
 * secrets whose only job is to be unguessable. Nothing in this pattern allows a dot, a slash or a
 * backslash in either half, so there is no relative path to write in a key and no parent directory to
 * climb into; `assetKeyFor` builds keys and this pattern is what says a key came from `assetKeyFor`.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** The key a board's asset lives under. One place, so writer and reader cannot drift apart. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** The two halves of a key, or null when the key is not a key. */
export function splitAssetKey(key: string): { boardId: string; assetId: string } | null {
  if (!ASSET_KEY_PATTERN.test(key)) return null;
  const [boardId, assetId] = key.split('/');
  return { boardId: boardId as string, assetId: assetId as string };
}

/** The bytes at the front of a file that decide its format. */
export const SNIFF_BYTES = IMAGE_SNIFF_BYTES;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0): boolean => {
  if (bytes.length < at + prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[at + index] !== prefix[index]) return false;
  }
  return true;
};

/** `GIF87a` and `GIF89a`: the two versions of the same format, both of which are GIF. */
const GIF_HEADERS: readonly (readonly number[])[] = [
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
];

/**
 * Which of the four formats these bytes are, or null for "not one we add to a board".
 *
 * Only the magic numbers are read, and only the first {@link SNIFF_BYTES} bytes are looked at: a PNG's
 * eight-byte signature is checked in full (it exists to catch a file that was mangled in transit), a JPEG
 * needs its `FF D8 FF` — the third byte is the start of the first marker and separates a real JPEG from a
 * stray pair of bytes — and a WebP needs both `RIFF` at 0 and `WEBP` at 8, which is why twelve bytes is
 * the sniffing window: it is the widest thing any of these formats needs.
 *
 * Nothing here reads a dimension or a chunk. The picture's own size comes from the browser's decoder
 * (`createImageBitmap`) on the way in and is stored with the object, because a browser that can draw a
 * picture already knows how big it is and this function's only job is to say what it is.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const bytes = head.length > SNIFF_BYTES ? head.subarray(0, SNIFF_BYTES) : head;
  if (bytes.length < 3) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A. The four that spell "PNG" would be enough to name the format; all
  // eight are checked because the extra four are the file's own warning that its first bytes were
  // rewritten by something that thought it was text.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // JPEG: SOI followed by a marker.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  // GIF: either version. A GIF that is really a GIF87a is a GIF; an animated one is a GIF too, and
  // plays in the `<img>` the object is drawn with, which is the whole of story 12's GIF animation.
  if (GIF_HEADERS.some((header) => startsWith(bytes, header))) return 'image/gif';

  // WebP: RIFF … WEBP. The four bytes between them are the RIFF chunk's own name and are not ours to
  // read here — VP8, VP8L and VP8X are all WebP to a browser.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }

  return null;
}
