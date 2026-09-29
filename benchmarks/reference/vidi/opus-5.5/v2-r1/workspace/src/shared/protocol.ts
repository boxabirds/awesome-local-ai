// y-websocket message framing, shared by the BoardRoom and tests.
//
// Every binary frame starts with a varUint message type:
//   MESSAGE_SYNC            varUint sync type (y-protocols/sync) + varUint8Array payload
//   MESSAGE_AWARENESS       varUint8Array awareness update
//   MESSAGE_QUERY_AWARENESS (no payload)
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for frames the room cannot understand. */
export const CLOSE_UNSUPPORTED_DATA = 1003;
/** WebSocket close code: the board's saved state cannot be loaded (client shows load failure). */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
/** WebSocket close code: a change could not be saved; the room resets and clients reconnect. */
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  /** `payload` is the whole sync message after the MESSAGE_SYNC type (sync type + data). */
  | { kind: 'sync'; payload: Uint8Array }
  /** `payload` is the awareness update bytes. */
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

const SYNC_TYPES: ReadonlySet<number> = new Set([
  syncProtocol.messageYjsSyncStep1,
  syncProtocol.messageYjsSyncStep2,
  syncProtocol.messageYjsUpdate,
]);

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Classifies one WebSocket frame. Never throws: anything malformed is `invalid`. */
export function decodeMessage(data: ArrayBuffer | ArrayBufferView | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes = toBytes(data);
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const payload = bytes.subarray(decoder.pos);
        // Validate the framing: sync type followed by one length-prefixed byte array.
        const syncType = decoding.readVarUint(decoder);
        if (!SYNC_TYPES.has(syncType)) return { kind: 'invalid', reason: `sync type ${syncType}` };
        decoding.readVarUint8Array(decoder);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'undecodable' };
  }
}

/** Frames a sync message: MESSAGE_SYNC followed by whatever `write` encodes. */
function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  return syncFrame((e) => syncProtocol.writeSyncStep1(e, doc));
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  return syncFrame((e) => syncProtocol.writeUpdate(e, update));
}

export function encodeAwareness(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeQueryAwareness(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}

/**
 * Applies a decoded sync payload to `doc` (with `origin`) and returns the framed reply,
 * or null when there is nothing to answer. Throws when Yjs rejects the update (unlike
 * `syncProtocol.readSyncMessage`, which logs and swallows the error).
 */
export function readSync(doc: Y.Doc, payload: Uint8Array, origin: unknown): Uint8Array | null {
  const decoder = decoding.createDecoder(payload);
  const syncType = decoding.readVarUint(decoder);
  if (syncType === syncProtocol.messageYjsSyncStep1) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncStep1(decoder, encoder, doc);
    return encoding.toUint8Array(encoder);
  }
  if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
    const update = decoding.readVarUint8Array(decoder);
    // Parse it completely first: a malformed update throws before any part of it is applied.
    Y.decodeUpdate(update);
    Y.applyUpdate(doc, update, origin);
    return null;
  }
  throw new Error(`unknown sync type ${syncType}`);
}
