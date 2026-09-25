/**
 * Board ids and the URLs that name them (story 3).
 *
 * The room a board lives in is named by the board id: two people are in the
 * same board exactly when their client derives the same room id, so the id is
 * worth defining carefully - it is a *URL-transportable identifier*, not a
 * display string.
 *
 * Decisions, and the failures they are there to prevent:
 *
 * - **16 random bytes (22 base64url characters).** Long enough that a guessed
 *   link is not a real risk between friends, short enough to copy out of a
 *   chat message. Story 5 puts real authorisation in front of the room, so
 *   this length is about *accidental* collisions, not about secrecy.
 * - **The base64url alphabet** (`A-Za-z0-9-_`, no padding): safe in a path, a
 *   query string, a JSON body and a `Map` key, and it survives a `URL`
 *   round-trip without percent-encoding.
 * - **Case is preserved, not normalised.** A room key is compared exactly
 *   (`live.no_fork`: two spellings must not fork), which is cheaper to reason
 *   about than a case-insensitive key space.
 * - **Validation is shape, not existence.** A client cannot know whether a
 *   room exists, and a well-formed id has to be connectable even the first
 *   time. An id that fails the shape test is a typo or a mis-paste, which is
 *   the only case the client can act on.
 *
 * The wire format (what the socket actually sends) lives in `./protocol.ts`.
 */

/** Length in bytes of the random part of a board id. */
export const BOARD_ID_BYTES = 16;

/** Length in characters of a board id: four base64 characters per three bytes. */
export const BOARD_ID_LENGTH = 22;

/** The prefix every board URL shares. */
export const BOARD_PATH_PREFIX = '/board/';

/**
 * What a board id looks like: `BOARD_ID_BYTES` bytes of random data in
 * base64url, unpadded. Deliberately stricter than "some random-looking
 * string" - a 21-character paste is a truncated link, and saying so beats
 * quietly opening a second, empty board that looks like the person's own.
 */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `value` could be a board id, judging by shape alone. */
export function isValidBoardId(value: string | null | undefined): boolean {
  return typeof value === 'string' && BOARD_ID_PATTERN.test(value);
}

/** The alphabet base64url uses: the URL-safe spelling of base64. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A fresh board id, from the platform's random source.
 *
 * `random` is injectable so a test can pin the ids it needs; production always
 * uses `crypto.getRandomValues`, the only randomness here that another board's
 * visitor cannot predict.
 */
export function newBoardId(random: () => Uint8Array = randomBytes): string {
  const bytes = random();
  let id = '';
  // Three bytes -> four characters. 16 bytes do not divide by three, so the
  // last group is one byte and yields two characters: 22 in total.
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] as number;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    id += BASE64URL[first >> 2];
    id += BASE64URL[((first & 0b11) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      id += BASE64URL[((second & 0b1111) << 2) | ((third ?? 0) >> 6)];
      id += third !== undefined ? BASE64URL[third & 0b111111] : '';
    }
  }
  return id;
}

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(bytes);
  // Only reachable without WebCrypto (an ancient browser). Board ids are not a
  // secret, but this is still the last place we want Math.random, so it is loud
  // rather than silent.
  console.warn('[vidi6] no WebCrypto: falling back to Math.random for the board id');
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** The path part of a board's URL. The id is the last path segment. */
export function boardPath(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}

/**
 * The short path a *shared link* uses (story 5): `/b/<id>`.
 *
 * Shorter to paste than `/board/`, and it is the address Share copies. The
 * older `/board/<id>` prefix (stories 1–4) is still resolved by
 * {@link parseBoardPath}, so boards already in somebody's bookmarks keep
 * working — a link is only a promise about an id, not about a prefix.
 */
export const BOARD_LINK_PREFIX = '/b/';

/** A whole shareable URL for a board, given an origin. */
export function boardLink(boardId: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${BOARD_LINK_PREFIX}${boardId}`;
}

/**
 * The board id in a pathname, or `null` when the path names no board.
 *
 * The id is read from the *last* segment, so `/board/<id>` names a board and
 * so does a proxy that puts a prefix in front of it (`/app/board/<id>`).
 * Anything else - `/`, `/board`, `/board/`, a path that still carries a query
 * or a fragment - names nothing: guessing a room out of `/settings` is exactly
 * the bug this function exists to prevent.
 */
export function parseBoardPath(path: string | null | undefined): string | null {
  if (!path) return null;
  // A URL may arrive whole (`/board/<id>?x=1#y`); a query and a fragment are
  // never part of an id, so they come off before the shape test.
  const clean = path.split('?')[0]?.split('#')[0] ?? '';
  const segments = clean.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1] ?? '';
  return isValidBoardId(last) ? last : null;
}

/** The room id a socket uses for a board: the board id, unchanged. */
export function roomIdFor(boardId: string): string {
  return boardId;
}
