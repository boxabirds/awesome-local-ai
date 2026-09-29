/**
 * y-websocket message framing, shared by the BoardRoom Durable Object,
 * the integration test clients and the unit tests (story 3).
 *
 * Every frame starts with a varuint message type (one byte for the values
 * below, matching the y-websocket client's `writeVarUint` framing):
 *
 *   MESSAGE_SYNC          0  payload = one y-protocols sync message
 *   MESSAGE_AWARENESS     1  payload = varuint8array (awareness update)
 *   MESSAGE_QUERY_AWARENS 3  no payload
 *
 * `decodeMessage` is pure: it classifies and structurally validates a
 * frame without a Y.Doc. Content-level errors (an update that Yjs
 * rejects) surface later, when the room applies the update.
 */
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const MESSAGE_SYNC_ACK = 64;

/** Close code for frames the room cannot use (string, truncated, unknown, invalid Yjs update). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Close code: the room's saved board could not be loaded (damaged snapshot or
 * storage read error). The room keeps retrying automatically; the client shows
 * the load-failure message and disables editing until a retry succeeds.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;

/**
 * Close code: the room's storage write failed, so the room discarded its
 * document and will reload from storage on the next connection. The board is
 * still readable, so the client treats this as a reconnect, not a load failure.
 */
export const CLOSE_STORAGE_FAILURE = 1011;

/** y-protocols sync message types (the varuint after MESSAGE_SYNC). */
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Classify one WebSocket frame.
 *
 * - string frames are invalid (the protocol is binary-only);
 * - a frame whose type byte is not one of the three known types is
 *   invalid (the room closes it with CLOSE_UNSUPPORTED_DATA);
 * - sync/awareness payloads must be fully framed (one complete
 *   y-protocols sync message / one complete varuint8array); truncated
 *   payloads are invalid.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frames are not supported' };
  }
  const bytes = new Uint8Array(data);
  try {
    const decoder = createDecoder(bytes);
    const type = readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        if (decoder.pos >= bytes.length) {
          return { kind: 'invalid', reason: 'empty sync payload' };
        }
        const payload = bytes.slice(decoder.pos);
        if (!isValidSyncPayload(payload)) {
          return { kind: 'invalid', reason: 'truncated or unknown sync message' };
        }
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const length = readVarUint(decoder);
        if (decoder.pos + length > bytes.length) {
          return { kind: 'invalid', reason: 'truncated awareness payload' };
        }
        return { kind: 'awareness', payload: bytes.slice(decoder.pos, decoder.pos + length) };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'undecodable frame' };
  }
}

/**
 * A sync payload must be exactly one complete y-protocols sync message:
 * a known type byte followed by a fully-framed varuint8array (state vector
 * for SyncStep1, update for SyncStep2/Update), with no trailing bytes.
 */
function isValidSyncPayload(payload: Uint8Array): boolean {
  try {
    const decoder = createDecoder(payload);
    const type = readVarUint(decoder);
    if (type !== SYNC_STEP1 && type !== SYNC_STEP2 && type !== SYNC_UPDATE) {
      return false;
    }
    readVarUint8Array(decoder);
    return decoder.pos === payload.length;
  } catch {
    return false;
  }
}
