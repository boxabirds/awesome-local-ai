import {
  createDecoder,
  readTailAsUint8Array,
  readVarUint,
  readVarUint8Array
} from 'lib0/decoding';

// y-websocket wire framing shared by the BoardRoom and the tests.
// A message is: varuint type, then type-specific bytes.
//   0 = sync (y-protocols/sync bytes), 1 = awareness (varuint8array update),
//   3 = query-awareness.
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;
// Story 4: a board whose saved state cannot be loaded (the client must show
// "This board couldn't be loaded. Retrying…", never an empty board).
export const CLOSE_BOARD_LOAD_FAILED = 4500;
// Story 4: the room could not store an update; clients reconnect and re-send
// their unsaved changes through the story 3 handshake.
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

// Decodes one WebSocket frame.
// - 'sync': payload is the bytes after the type varuint, ready for
//   y-protocols/sync readSyncMessage.
// - 'awareness': payload is the complete frame bytes (awareness is relayed
//   verbatim, never interpreted, in this story).
// - string frames, undecodable bytes and unknown types decode to 'invalid'.
export function decodeMessage(data: ArrayBuffer | ArrayBufferView | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  try {
    const decoder = createDecoder(bytes);
    const type = readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
        return { kind: 'sync', payload: readTailAsUint8Array(decoder) };
      case MESSAGE_AWARENESS:
        // Validate the declared varuint8array length actually fits.
        readVarUint8Array(decoder);
        return { kind: 'awareness', payload: bytes };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'malformed message' };
  }
}
