// The wire framing of the live board: y-websocket message types, shared by
// the BoardRoom Durable Object and by the tests that speak the protocol.
//
// Every frame is `varuint(messageType)` followed by its payload:
//
//   0 sync             a y-protocols/sync message (step 1, step 2 or update)
//   1 awareness        a y-protocols/awareness update
//   3 query-awareness "send me every awareness state you know"
//
// Text frames are never sent by the provider and are rejected by the room.
import * as decoding from 'lib0/decoding';

/** y-websocket frame type: a sync message (step 1, step 2 or document update). */
export const MESSAGE_SYNC = 0;
/** y-websocket frame type: an awareness update, relayed verbatim by the room. */
export const MESSAGE_AWARENESS = 1;
/** y-websocket frame type: awareness query; ignored in this story. */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code sent to a socket that sent data the room cannot use. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/** y-protocols/sync sub-message types (the first byte of a sync payload). */
export const SYNC_STEP_1 = 0;
export const SYNC_STEP_2 = 1;
export const SYNC_UPDATE = 2;

/** Result of reading one WebSocket frame, discriminated by `kind`. */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

const invalid = (reason: string): Decoded => ({ kind: 'invalid', reason });

const isSyncSubType = (type: number): boolean =>
  type === SYNC_STEP_1 || type === SYNC_STEP_2 || type === SYNC_UPDATE;

/**
 * Read one frame. Never throws: anything the room cannot act on — a text
 * frame, a frame whose type or length cannot be read, an unknown type or a
 * payload cut short — comes back as `{ kind: 'invalid', reason }` so the
 * caller can close just that socket.
 *
 * `payload` is everything after the frame's own type byte: for a sync frame
 * the sync message (its first byte is a SYNC_* sub-type, validated here), for
 * an awareness frame the encoded awareness update.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  // The provider only ever sends binary frames; a text frame carries no
  // document information the room could act on.
  if (typeof data === 'string') return invalid('text frames are not supported');
  if (data.byteLength === 0) return invalid('empty frame');

  const buffer = new Uint8Array(data);
  const decoder = decoding.createDecoder(buffer);
  try {
    const type = decoding.readVarUint(decoder);
    const payloadStart = decoder.pos;

    switch (type) {
      case MESSAGE_SYNC: {
        // The sub-type is validated so that garbage inside the payload still
        // reaches Yjs (which rejects it) instead of being silently dropped.
        const subType = decoding.readVarUint(decoder);
        if (!isSyncSubType(subType)) return invalid(`unknown sync message ${subType}`);
        return { kind: 'sync', payload: buffer.slice(payloadStart) };
      }
      case MESSAGE_AWARENESS: {
        // The awareness update itself (the frame's length prefix is not part
        // of it); reading it this way also proves the frame is complete.
        const update = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload: update };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return invalid(`unknown message type ${type}`);
    }
  } catch {
    return invalid('frame is truncated or malformed');
  }
}

/**
 * 426 Upgrade Required: the address is a board's room, but what arrived is not a
 * WebSocket upgrade. The client that asked without upgrading is told what it
 * should have done rather than being served a page.
 */
export const STATUS_UPGRADE_REQUIRED = 426;

/** 400 Bad Request: the address is not a well-formed board id, so there is no
 *  such board to reach and no room to create for it.
 */
export const STATUS_INVALID_BOARD_ID = 400;
