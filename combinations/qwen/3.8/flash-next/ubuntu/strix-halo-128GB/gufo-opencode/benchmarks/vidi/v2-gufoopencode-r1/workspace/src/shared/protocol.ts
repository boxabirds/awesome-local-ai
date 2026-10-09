// y-websocket message framing shared by the BoardRoom and the tests.
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;
// Story 4: the room could not load its persisted document (client shows the
// load-failed state and keeps retrying), and the room lost its storage and
// had to close everybody because changes can no longer be made durable.
export const CLOSE_BOARD_LOAD_FAILED = 4500;
export const CLOSE_STORAGE_FAILURE = 1011;

// y-protocols/sync message kinds (the varint that follows MESSAGE_SYNC).
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

interface VarUInt {
  value: number;
  pos: number;
}

// Bounds-checked varint reader. lib0's reader loops forever past the end of a
// buffer, and the room must never hand structurally truncated bytes to Yjs.
function readVarUintChecked(bytes: Uint8Array, pos: number): VarUInt | null {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (pos >= bytes.length) return null;
    const byte = bytes[pos];
    pos += 1;
    value += (byte & 0b01111111) * Math.pow(2, shift);
    if (byte < 0b10000000) return { value, pos };
    shift += 7;
    if (shift > 42) return null; // longer than a 64-bit varint could mean
  }
}

function readBytesChecked(bytes: Uint8Array, pos: number): VarUInt | null {
  const length = readVarUintChecked(bytes, pos);
  if (length === null) return null;
  const end = length.pos + length.value;
  if (end > bytes.length) return null;
  return { value: length.value, pos: end };
}

// Every y-protocols sync body is `[kind varuint][varuint-length-prefixed
// payload]` (state vector, update, or update). The outer length prefix must
// match the remainder of the frame exactly, otherwise readSyncMessage's
// reader would run past the end of the buffer.
function structurallyValidSyncBody(kind: number, bytes: Uint8Array, pos: number): boolean {
  if (kind !== SYNC_STEP1 && kind !== SYNC_STEP2 && kind !== SYNC_UPDATE) return false;
  const payload = readBytesChecked(bytes, pos);
  return payload !== null && payload.pos === bytes.length;
}

// Decodes one WebSocket frame. `payload` is everything after the leading
// message-type varint. Any text frame, unknown message type or structurally
// truncated body decodes as invalid so the room can close the socket instead
// of feeding partial bytes to Yjs.
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frames are not supported' };
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) return { kind: 'invalid', reason: 'empty message' };
  const head = readVarUintChecked(bytes, 0);
  if (head === null) return { kind: 'invalid', reason: 'truncated message type' };
  switch (head.value) {
    case MESSAGE_SYNC: {
      const kind = readVarUintChecked(bytes, head.pos);
      if (kind === null) return { kind: 'invalid', reason: 'truncated sync protocol message' };
      if (kind.value !== SYNC_STEP1 && kind.value !== SYNC_STEP2 && kind.value !== SYNC_UPDATE) {
        return { kind: 'invalid', reason: `unknown sync protocol message ${String(kind.value)}` };
      }
      if (!structurallyValidSyncBody(kind.value, bytes, kind.pos)) {
        return { kind: 'invalid', reason: 'truncated sync body' };
      }
      return { kind: 'sync', payload: bytes.subarray(head.pos) };
    }
    case MESSAGE_AWARENESS: {
      if (head.pos >= bytes.length) return { kind: 'invalid', reason: 'truncated awareness update' };
      return { kind: 'awareness', payload: bytes.subarray(head.pos) };
    }
    case MESSAGE_QUERY_AWARENESS: {
      if (head.pos < bytes.length) return { kind: 'invalid', reason: 'unexpected content after query-awareness' };
      return { kind: 'query-awareness' };
    }
    default:
      return { kind: 'invalid', reason: `unknown message type ${String(head.value)}` };
  }
}
