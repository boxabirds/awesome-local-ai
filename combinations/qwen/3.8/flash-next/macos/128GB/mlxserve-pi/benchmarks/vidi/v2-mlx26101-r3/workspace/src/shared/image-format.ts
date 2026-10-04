/**
 * What a file actually is, decided from its own bytes, and where in the bucket it is kept.
 *
 * Two jobs that belong together. The first is the one the PRD's "rejected with a clear message" depends
 * on: a browser's `File.type` is a claim taken from the filename's extension, so a PDF renamed
 * `holiday.png` arrives as `image/png` and is a document all the way down. The bytes at the front of a
 * file are not a claim - every one of these four formats starts with a signature that says what it is -
 * so the signature is what the worker reads, and what the answer is based on.
 *
 * The second is the key. An asset key is `<boardId>/<22 random characters>`, and the randomness is the
 * only access control on the bucket: there is no list of a board's assets, no signed URL and no session
 * in front of a picture, so a key nobody can guess is what stands between a stranger and somebody else's
 * photographs. See {@link assetKeyFor} for the arithmetic and {@link ASSET_KEY_PATTERN} for the shape.
 */
import type { AcceptedImageType } from './config';
import { isValidBoardId } from './board-id';

/**
 * The four signatures, in the formats this module understands.
 *
 * PNG is eight bytes, and the eighth of them is there specifically to catch a file that has been
 * converted by something that did not understand the format: a CRLF inserted by a text-mode transfer
 * changes byte 3 from `0D` to `0A` and the file is a picture no more. JPEG is three bytes - Start Of
 * Frame is not one of them, `FF D8 FF` is the three that every JPEG encoder emits first. GIF is the
 * six characters of its version string, and there are exactly two versions that ever shipped with
 * anything a browser can draw. WebP is the awkward one: `RIFF`, then a length nobody cares about, then
 * `WEBP` - which is why this module needs {@link IMAGE_SNIFF_BYTES} rather than four.
 */
const SIGNATURES: ReadonlyArray<{ readonly type: AcceptedImageType; readonly bytes: readonly number[]; readonly offset: number }> = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], offset: 0 }, // GIF87a
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], offset: 0 }, // GIF89a
  { type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF
  { type: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // ....WEBP
];

/**
 * Which of the accepted image types `head` is the beginning of, or `null` for anything else.
 *
 * `head` is the leading bytes of a file - {@link IMAGE_SNIFF_BYTES} of them is enough for every
 * signature - and a file shorter than the signature it might have been is simply not that signature.
 * Nothing here decodes an image: the question is "are these the bytes of a PNG", and the bytes answer it.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  for (const signature of SIGNATURES) {
    const { type, bytes, offset } = signature;
    if (head.length < offset + bytes.length) {
      continue;
    }
    let matches = true;
    for (let index = 0; index < bytes.length; index += 1) {
      if (head[offset + index] !== bytes[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      // A RIFF file is only a WebP if the second half of its signature agrees, so the loop above has to
      // have checked both parts before the answer is given - which it has, because the two WebP entries
      // are matched in turn and the first one to fail ends that candidate, not the whole search.
      if (type === 'image/webp') {
        // The 'RIFF' entry alone is not enough: only say yes once the `WEBP` at offset 8 has been seen.
        if (!hasBytes(head, [0x57, 0x45, 0x42, 0x50], 8)) {
          continue;
        }
      }
      return type;
    }
  }
  return null;
}

/** Whether `bytes` are found at `offset`. A file that stops before them does not have them. */
function hasBytes(head: Uint8Array, bytes: readonly number[], offset: number): boolean {
  if (head.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => head[offset + index] === byte);
}

/**
 * What an asset key looks like: a board id, a slash, and twenty-two characters from the same alphabet
 * the board ids use.
 *
 * The serving route matches the whole thing, anchored at both ends, because the key is also a path and
 * a path that can contain `..`, a second slash or nothing at all is a route that serves things nobody
 * meant to serve. Both halves are 22 base64url characters - the board half because it is a board id
 * ({@link BOARD_ID_PATTERN} says so), the asset half because it is 16 random bytes encoded the same way.
 * One alphabet, one length, one rule, and a route that can be written as one regular expression.
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/**
 * The bucket key an uploaded file gets: `<boardId>/<assetId>`.
 *
 * The board half is not decoration. Every board's assets share one bucket, and a prefix that is the
 * board's id is what makes "the assets of this board" a question the bucket can answer - and what makes a
 * key meaningless to anybody who has not been given a board to be part of. It is also what lets the
 * serving route check that the board in the path is the board the key was made for, in one regular
 * expression and without asking the document anything.
 *
 * The randomness is not made here. The caller passes an id from story 5's {@link newBoardId} - 16 bytes,
 * 128 bits, the same alphabet and the same length as a board id - because that is the one place in this
 * product that knows how to make something unguessable, and a second implementation of it would be a
 * second thing to get wrong. The PRD's "the asset key is unguessable" is about a stranger who knows a
 * board's id and would like a photograph from it: they may not read the board's document, and this key is
 * the one thing they would have to guess.
 *
 * @throws when either half is not the shape it has to be, because a key that {@link ASSET_KEY_PATTERN}
 * does not match is a key whose asset can never be served back - which is a silently lost image.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  // Both halves are checked with the same rule, because both are 22 base64url characters and the key is
  // only servable if both of them are. The board half has a name already; the asset half borrows it.
  if (!isValidBoardId(boardId)) {
    throw new Error(`asset key refused: ${JSON.stringify(boardId)} is not a board id`);
  }
  if (!isValidBoardId(assetId)) {
    throw new Error(`asset key refused: ${JSON.stringify(assetId)} is not 22 characters of the board id alphabet`);
  }
  return `${boardId}/${assetId}`;
}
