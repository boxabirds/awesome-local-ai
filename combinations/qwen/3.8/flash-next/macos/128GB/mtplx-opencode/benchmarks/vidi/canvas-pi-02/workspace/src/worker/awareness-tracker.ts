import { MESSAGE_AWARENESS } from '../shared/protocol';

/**
 * Reading and writing awareness traffic (story 6, task 7).
 *
 * The room does not *interpret* presence - it has no opinion about who is
 * pointing at what - but it cannot forget it either. Two things depend on
 * knowing which awareness clients a given socket announced:
 *
 *  - when that socket closes, the other members have to be told those people
 *    are gone, or a board keeps drawing a person whose laptop is shut;
 *  - that has to work after the room has been asleep, which is why the answer
 *    is kept in the socket's attachment rather than in a `Map` on the instance.
 *
 * So this file decodes just enough of an awareness update to answer "which
 * clients, at which clocks", and encodes the one reply the room needs to send:
 * "these clients are gone".
 *
 * ## The wire format, because it is not self-describing
 *
 * A frame is `[1][length : varUint][body]` and the body is
 *
 * ```text
 * [varUint count]
 * for each entry: [varUint clientId][varUint clock][varString jsonState]
 * ```
 *
 * `jsonState` is `JSON.stringify` of the state, so a *removal* is the literal
 * four characters `null` at the client's current clock - and `y-protocols` only
 * honours that when the receiver's clock is already equal to it. That is why the
 * clock is carried along instead of being restarted.
 *
 * `readAwarenessClients` takes the *body* (the update inside the frame), because
 * that is what `decodeMessage` hands over; `encodeAwarenessRemoval` produces a
 * whole *frame*, because that is what `frameToReply` takes back. Neither function
 * knows about the other, and the room never has to re-frame or un-frame anything.
 *
 * ## Why the parsing is written out here
 *
 * `lib0/decoding` would do this in fewer lines, and it *throws* when a reader
 * runs off the end of the buffer. Every input to these functions comes from a
 * socket, so "throws" would mean one malformed frame ends a board session. The
 * readers below return `null` instead, which is the same rule story 4 set for
 * `decodeMessage`: a frame that cannot be read is refused, never acted on.
 */

/** The largest entry count accepted before a blob is treated as garbage. */
const MAX_ENTRIES = 1024;

/** What a removed state looks like on the wire: `JSON.stringify(null)`. */
const REMOVAL_STATE = 'null';

/** What one parsed entry turned out to be. */
interface Entry {
  clientId: number;
  clock: number;
  /** True when the state was JSON `null`, which means "this person is gone". */
  removed: boolean;
}

/** Read a varUint, or `null` if it runs off the end or is absurdly long. */
function readVarUint(bytes: Uint8Array, position: { index: number }): number | null {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (position.index >= bytes.length) return null;
    const byte = bytes[position.index]!;
    position.index += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) return null;
  }
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Read a length-prefixed UTF-8 string body, bounds-checked. */
function readVarString(
  bytes: Uint8Array,
  position: { index: number },
): string | null {
  const length = readVarUint(bytes, position);
  if (length === null) return null;
  if (position.index + length > bytes.length) return null;
  const text = new TextDecoder().decode(bytes.subarray(position.index, position.index + length));
  position.index += length;
  return text;
}

/** The bytes of one varUint, most-significant-nibble last. */
function toVarUint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>>= 7;
    out.push(rest > 0 ? byte | 0x80 : byte);
    if (rest === 0) return out;
  }
}

/**
 * Decode the entries of one awareness update.
 *
 * `null` means *this blob is not awareness traffic*: an empty body, a count that
 * runs past the end, an entry whose JSON is broken or a length that does not fit
 * the buffer. It never throws, and it never partially succeeds - half a read is
 * exactly as untrustworthy as no read at all, and the room's other rule is that
 * a frame it cannot read still gets relayed untouched.
 */
function readEntries(update: Uint8Array): Entry[] | null {
  if (update.byteLength === 0) return null;
  const position = { index: 0 };
  const count = readVarUint(update, position);
  if (count === null || count === 0 || count > MAX_ENTRIES) return null;

  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    const clientId = readVarUint(update, position);
    if (clientId === null) return null;
    const clock = readVarUint(update, position);
    if (clock === null) return null;
    const json = readVarString(update, position);
    if (json === null) return null;
    let state: unknown;
    try {
      state = JSON.parse(json);
    } catch {
      // Not JSON: somebody's ping, a foreign client or a truncated frame. None of
      // those is a reason to change what the room thinks about who is here.
      return null;
    }
    // A state is an object of fields (`user`, `cursor`, `selection`) or `null`.
    // Anything else is not something the room will keep a record of.
    if (state !== null && typeof state !== 'object') return null;
    entries.push({ clientId, clock, removed: state === null });
  }
  // Every byte has to have been consumed: a body with trailing bytes is a body
  // whose structure was guessed at, not read.
  if (position.index !== update.byteLength) return null;
  return entries;
}

/**
 * Which clients does this update name, and at which clocks?
 *
 * Clients whose state is `null` are *not* in the result: they were announced as
 * gone, and a room that kept tracking them would go on telling everyone about a
 * person who left long after that person's own clients stopped believing it.
 *
 * The clocks matter because awareness is versioned by clock, not by content: a
 * removal has to be sent at the clock the receivers already hold, or they will
 * file it under "out of date" and keep drawing the ghost.
 */
export function readAwarenessClients(update: Uint8Array): Map<number, number> | null {
  const entries = readEntries(update);
  if (entries === null) return null;
  const clients = new Map<number, number>();
  for (const entry of entries) {
    if (entry.removed) continue;
    clients.set(entry.clientId, entry.clock);
  }
  return clients;
}

/**
 * The one entry, if this update is a person speaking about themselves.
 *
 * A room has to know whose presence a socket speaks for, so that when the socket
 * goes it can say so. "Every client id in the frame" is the obvious rule and it
 * is wrong: `y-websocket` answers a presence query by forwarding *everybody's*
 * state it happens to hold, so a socket that merely carried a reply would be
 * charged with everybody it carried, and leaving would take three idle people off
 * the board until their next clock renewal fifteen seconds later.
 *
 * What a client sends about itself is always exactly one entry -
 * `encodeAwarenessUpdate(awareness, [doc.clientID])`: its own announcements, its
 * cursor, its selection, its farewell. Anything with two or more entries is a
 * relay, and a relay is not an announcement.
 */
export function readOwnAnnouncement(update: Uint8Array): Map<number, number> | null {
  const entries = readEntries(update);
  if (entries === null || entries.length !== 1) return null;
  const [only] = entries;
  if (only === undefined || only.removed) return null;
  return new Map([[only.clientId, only.clock]]);
}

/**
 * Encode "these clients are gone" as one complete wire frame.
 *
 * The result is a frame, not a body: `[1][length][count + entries]`, ready for
 * `frameToReply`, and `decodeMessage` classifies it as awareness traffic (which
 * is how the tests check the framing rather than trusting it).
 *
 * Each entry repeats the clock the room last saw for that client, with a `null`
 * state: that is the shape `y-protocols` treats as a removal *at the same clock*,
 * which is what makes it land on a client that already has the person. Inventing
 * a higher clock would also "work" and be wrong in general - the room does not
 * own those clients, and making up a version for somebody else's state is how a
 * server starts lying about who is in the room.
 *
 * The bytes are built in a growable array rather than a fixed buffer. A
 * `Uint8Array` silently ignores a write past its end, so a fixed buffer that runs
 * out does not fail: it produces a plausible-looking frame whose declared lengths
 * are a lie, which is the one failure mode this file exists to avoid. The length
 * prefix is written *after* the body it describes, for the same reason.
 */
export function encodeAwarenessRemoval(clients: Map<number, number>): Uint8Array {
  const entries = [...clients.entries()].filter(([, clock]) => Number.isFinite(clock));
  const body: number[] = [...toVarUint(entries.length)];
  for (const [clientId, clock] of entries) {
    // `varString` is a byte length, then the bytes. `JSON.stringify(null)` is the
    // four characters the receiver will `JSON.parse` back into `null`; an empty
    // string would throw there, which is the difference between a removal and a
    // broken frame.
    body.push(
      ...toVarUint(clientId),
      ...toVarUint(clock),
      ...toVarUint(REMOVAL_STATE.length),
      ...[...REMOVAL_STATE].map((character) => character.charCodeAt(0)),
    );
  }
  return Uint8Array.from([MESSAGE_AWARENESS, ...toVarUint(body.length), ...body]);
}

/**
 * Fold one update's clients into what a socket already knew.
 *
 * Two rules, both about not losing information: the *highest* clock seen for a
 * client is kept (a lower one is an older version of the same state), and a
 * client announced as gone is never re-added by the merge. The result is a plain
 * object because it is stored in a WebSocket attachment, and an attachment is
 * serialised to JSON - a `Map` would come back as `{}`.
 */
export function mergeTracked(
  previous: Record<string, number>,
  next: Map<number, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...previous };
  for (const [clientId, clock] of next) {
    const key = String(clientId);
    const known = merged[key];
    // `known === undefined` is a new client; an existing one only moves forward.
    // A tie keeps the current value, which is the same answer and costs nothing
    // to state.
    if (known === undefined || clock > known) merged[key] = clock;
  }
  return merged;
}

/**
 * Read the clients a socket was the only voice for.
 *
 * Called when that socket closes: whatever it had announced belongs to the person
 * behind it, and nobody else can speak for them. An empty result is the common
 * case - a socket that only ever received is a socket whose close means nothing
 * to anybody's presence - and the caller sends nothing in that case.
 */
export function clientsFromAttachment(
  attachment: Record<string, number> | undefined,
): Map<number, number> {
  const clients = new Map<number, number>();
  if (!attachment) return clients;
  for (const [key, clock] of Object.entries(attachment)) {
    const clientId = Number(key);
    if (!Number.isInteger(clientId) || clientId < 0) continue;
    if (!Number.isFinite(clock)) continue;
    clients.set(clientId, clock);
  }
  return clients;
}
