/**
 * Who this browser tab is, as far as anybody else on the board is concerned.
 *
 * Awareness carries a display name and a colour; story 6 adds the cursor position to
 * the same record. Nothing here goes into the `Y.Doc`: my name is not part of the
 * board, and the board must not fill up with things that only belong to one screen.
 *
 * The identity is created once per browser session and remembered after that, so a
 * reload does not turn you into a different person every time.
 */

/** Where the identity is remembered for the rest of the session. */
export const IDENTITY_STORAGE_KEY = 'vidi6-identity';

/** Colours an identity can be given. A fixed palette, so people stay recognisable. */
export const IDENTITY_COLORS: readonly string[] = [
  '#E91E63',
  '#3F51B5',
  '#009688',
  '#FF9800',
  '#673AB7',
  '#00838F',
  '#558B2F',
  '#BF360C',
];

/** What one board participant publishes about themselves. */
export interface BoardIdentity {
  /** The name other people see. */
  name: string;
  /** The colour other people see it in. */
  color: string;
}

let current: BoardIdentity | null = null;

/** A name like "Guest 4F2A" — short, and different in every new session. */
function guestName(seed: number): string {
  return `Guest ${(seed % 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

function randomSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(2);
    crypto.getRandomValues(bytes);
    return (bytes[0] ?? 0) * 256 + (bytes[1] ?? 0);
  }
  return Math.floor(Math.random() * 0xffff);
}

function read(session: Storage | null): BoardIdentity | null {
  if (session === null) return null;
  const stored = session.getItem(IDENTITY_STORAGE_KEY);
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { name?: unknown }).name === 'string' &&
      typeof (parsed as { color?: unknown }).color === 'string'
    ) {
      const { name, color } = parsed as { name: string; color: string };
      return { name, color };
    }
  } catch {
    // A value we cannot read is a value we should replace, not argue with.
  }
  return null;
}

function write(session: Storage | null, identity: BoardIdentity): void {
  try {
    session?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private mode with storage turned off: the identity still works, just for this tab.
  }
}

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * This tab's identity: read back from the session if it was made before, created and
 * stored otherwise. Stable for the whole session, and stable across calls, so the
 * awareness record is written once and never rewritten.
 */
export function boardIdentity(): BoardIdentity {
  if (current !== null) return current;
  const store = session();
  const stored = read(store);
  if (stored !== null) {
    current = stored;
    return current;
  }
  const seed = randomSeed();
  const color = IDENTITY_COLORS[seed % IDENTITY_COLORS.length] as string;
  current = { name: guestName(seed), color };
  write(store, current);
  return current;
}

/** Test hook: forget the identity, so a test can watch it being created again. */
export function resetBoardIdentity(): void {
  current = null;
}
