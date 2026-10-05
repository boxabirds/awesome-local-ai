/**
 * The wire format of a board connection, shared by the room and the tests.
 *
 * The browser side of the connection is the `y-websocket` client provider, which
 * wraps every message in one byte telling the server what kind it is. The room
 * has to read that byte the same way, and the tests have to speak it exactly like
 * a browser does — so the constants and the decoding live here, in one place both
 * sides can import, rather than being copied into each.
 *
 * A frame is: the message type as a varUint, then the message itself. The room
 * never interprets the payload here; it hands sync frames to Yjs and relays
 * awareness frames as they arrived.
 */
import * as decoding from 'lib0/decoding';

/** Carries Yjs document state: sync steps and document updates. */
export const MESSAGE_SYNC = 0;
/** Carries presence information (who is here, where their cursor is). */
export const MESSAGE_AWARENESS = 1;
/** Asks for the awareness states the server holds. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code for data the protocol cannot use (RFC 6455 "unsupported data"). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** What one received frame turned out to be. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Split one received frame into its type and payload.
 *
 * Anything the room cannot use comes back as `{ kind: 'invalid' }` with a reason:
 * a text frame (the protocol is binary), an empty buffer, a type nobody defined,
 * or a frame that stops in the middle of the message it announced. The caller
 * closes that one socket on `invalid`; it is never a reason to disturb anyone
 * else on the board.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'the board protocol is binary, not text' };
  }
  if (data.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty message' };
  }

  let decoder: decoding.Decoder;
  let type: number;
  try {
    decoder = decoding.createDecoder(new Uint8Array(data));
    type = decoding.readVarUint(decoder);
  } catch (error) {
    return { kind: 'invalid', reason: `unreadable message type: ${describe(error)}` };
  }

  if (type === MESSAGE_QUERY_AWARENESS) return { kind: 'query-awareness' };

  if (type === MESSAGE_SYNC) {
    // A sync frame is the frame's whole remainder: Yjs reads the sync step out of
    // it itself, so there is nothing to length-check here — except that a frame
    // which announced a sync message and then stopped announces a step that is not
    // there, and no step is worth handing to Yjs.
    const payload = decoding.readTailAsUint8Array(decoder);
    if (payload.byteLength === 0) {
      return { kind: 'invalid', reason: 'sync message has no step in it' };
    }
    return { kind: 'sync', payload };
  }

  if (type === MESSAGE_AWARENESS) {
    try {
      return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
    } catch (error) {
      return { kind: 'invalid', reason: `awareness message is truncated: ${describe(error)}` };
    }
  }

  // A type this build has no handler for is undecodable data as far as the room
  // is concerned: later stories' message kinds are not something to guess at.
  return { kind: 'invalid', reason: `unknown message type ${type}` };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
