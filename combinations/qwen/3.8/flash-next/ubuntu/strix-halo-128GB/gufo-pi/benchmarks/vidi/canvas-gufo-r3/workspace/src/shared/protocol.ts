/**
 * Shared y-websocket message framing (https://github.com/yjs/y-websocket).
 *
 * A message on the wire is a variable-length unsigned integer message type
 * followed by a type-specific body:
 *   MESSAGE_SYNC  -> a y-protocols/sync sub-message (varUint syncType + payload)
 *   MESSAGE_AWARENESS -> a varUint8Array awareness update
 *   MESSAGE_QUERY_AWARENESS -> no body
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

// y-protocols/sync sub-message types (mirrored here so decode can validate without
// importing y-protocols into every consumer).
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

/** Close code for a frame the room cannot process (WebSocket "unsupported data"). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

function invalid(reason: string): Decoded {
  return { kind: 'invalid', reason };
}

/** Bounds-checked lib0 varUint reader; throws if the value runs off the end. */
function readVarUintChecked(bytes: Uint8Array, pos: number): { value: number; pos: number } {
  let num = 0;
  let shift = 0;
  let byte: number;
  for (let i = 0; ; i++) {
    if (pos >= bytes.length) throw new Error('truncated varUint');
    byte = bytes[pos++];
    num += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (i >= 8) throw new Error('varUint too long');
  }
  return { value: num, pos };
}

/**
 * Decode one inbound websocket frame. Returns a tagged result; any structural
 * problem (text frame, empty buffer, truncated varUint8Array, unknown type)
 * yields `{ kind: 'invalid' }` so the caller can close the offending socket.
 */
export function decodeMessage(data: ArrayBuffer | Uint8Array | string): Decoded {
  if (typeof data === 'string') return invalid('text frames are not supported');

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) return invalid('empty message');

  let messageType: number;
  let pos: number;
  try {
    const r = readVarUintChecked(bytes, 0);
    messageType = r.value;
    pos = r.pos;
  } catch {
    return invalid('unreadable message type');
  }

  switch (messageType) {
    case MESSAGE_SYNC: {
      const start = pos;
      let r: { value: number; pos: number };
      try {
        r = readVarUintChecked(bytes, pos);
      } catch {
        return invalid('truncated sync message');
      }
      const syncType = r.value;
      pos = r.pos;
      if (syncType !== SYNC_STEP_1 && syncType !== SYNC_STEP_2 && syncType !== SYNC_UPDATE) {
        return invalid('unknown sync type');
      }
      try {
        r = readVarUintChecked(bytes, pos);
      } catch {
        return invalid('truncated sync message');
      }
      const len = r.value;
      pos = r.pos;
      if (pos + len > bytes.length) return invalid('truncated sync message');
      // payload = the sync sub-message, positioned so y-protocols/sync.readSyncMessage
      // can read the syncType varUint directly.
      return { kind: 'sync', payload: bytes.subarray(start) };
    }
    case MESSAGE_AWARENESS: {
      let r: { value: number; pos: number };
      try {
        r = readVarUintChecked(bytes, pos);
      } catch {
        return invalid('truncated awareness message');
      }
      const len = r.value;
      pos = r.pos;
      if (pos + len > bytes.length) return invalid('truncated awareness message');
      return { kind: 'awareness', payload: bytes.subarray(pos, pos + len) };
    }
    case MESSAGE_QUERY_AWARENESS:
      return { kind: 'query-awareness' };
    default:
      return invalid(`unknown message type ${messageType}`);
  }
}
