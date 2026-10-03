/**
 * The wire format between a board's clients and its room.
 *
 * Messages use the `y-websocket` framing: a variable-length unsigned integer
 * selecting the message kind, followed by that kind's payload. The room and the
 * tests share these constants and this decoder, so a frame the room accepts is a
 * frame the tests can build, and a frame they corrupt is corrupted in the same
 * way a hostile client would corrupt it.
 */
import * as decoding from 'lib0/decoding';

/** Document sync (y-protocols/sync). */
export const MESSAGE_SYNC = 0;
/** Awareness update, relayed unchanged by the room. */
export const MESSAGE_AWARENESS = 1;
/** A request for the room's awareness state; ignored in story 3. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code for a message the room cannot use (RFC 6455 "unsupported data"). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** The sub-kinds y-protocols writes behind `MESSAGE_SYNC`. */
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

function invalid(reason: string): Decoded {
  return { kind: 'invalid', reason };
}

/**
 * A sync message is a sub-kind followed by its payload. The two handshake kinds
 * are checked here, byte by byte. A `SYNC_UPDATE` payload is a Yjs update, which
 * only Yjs can judge, so it is passed on for the room to apply — Yjs rejecting it
 * is what closes the socket in that case.
 */
function decodeSync(payloadStart: number, bytes: Uint8Array): Decoded {
  const decoder = new decoding.Decoder(bytes);
  decoder.pos = payloadStart;
  let syncKind: number;
  try {
    syncKind = decoding.readVarUint(decoder);
  } catch (error) {
    return invalid(`sync message has no kind: ${message(error)}`);
  }
  if (syncKind !== SYNC_STEP_1 && syncKind !== SYNC_STEP_2 && syncKind !== SYNC_UPDATE) {
    return invalid(`unknown sync kind ${syncKind}`);
  }
  if (syncKind !== SYNC_UPDATE) {
    try {
      decoding.readVarUint8Array(decoder);
    } catch (error) {
      return invalid(`sync message is truncated: ${message(error)}`);
    }
  }
  return { kind: 'sync', payload: bytes.slice(payloadStart) };
}

/**
 * y-websocket sends an awareness update as one length-prefixed blob, and the blob
 * is a client count followed by that many `clientId, clock, JSON state` entries —
 * the order `y-protocols/awareness.applyAwarenessUpdate` reads them. A frame that
 * stops in the middle of one of them is rejected here rather than half-applied
 * later, and the room never relays bytes it cannot account for.
 */
function decodeAwareness(payloadStart: number, bytes: Uint8Array): Decoded {
  const decoder = new decoding.Decoder(bytes);
  decoder.pos = payloadStart;
  let update: Uint8Array;
  try {
    update = decoding.readVarUint8Array(decoder);
  } catch (error) {
    return invalid(`awareness update is truncated: ${message(error)}`);
  }
  const entries = new decoding.Decoder(update);
  try {
    const clients = decoding.readVarUint(entries);
    for (let index = 0; index < clients; index += 1) {
      decoding.readVarUint(entries); // client id
      decoding.readVarUint(entries); // clock
      decoding.readVarString(entries); // state as JSON
    }
  } catch (error) {
    return invalid(`awareness update is truncated: ${message(error)}`);
  }
  return { kind: 'awareness', payload: bytes.slice(payloadStart) };
}

/**
 * Split one WebSocket message into its kind and payload.
 *
 * Anything the room must not act on comes back as `{ kind: 'invalid' }` with a
 * reason: a text frame, an empty message, a frame whose type is unknown, or a
 * frame that stops in the middle of its payload. The caller closes the offending
 * socket; no exception escapes this function.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return invalid('text frames are not supported');
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) return invalid('empty message');
  const decoder = new decoding.Decoder(bytes);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch (error) {
    return invalid(`unreadable message type: ${message(error)}`);
  }
  switch (type) {
    case MESSAGE_SYNC:
      return decodeSync(decoder.pos, bytes);
    case MESSAGE_AWARENESS:
      return decodeAwareness(decoder.pos, bytes);
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return invalid(`unknown message type ${type}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
