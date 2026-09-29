import * as decoder from 'lib0/decoding';
import * as encoder from 'lib0/encoding';

/**
 * Wire protocol: the exact framing spoken by `y-websocket`'s standard
 * `WebsocketProvider`.
 *
 * Every WebSocket message is: `varuint(outerType) + payload`
 *
 *   outerType 0 (messageSync):
 *     payload = a raw y-protocols sync message, appended directly (NOT
 *     length-prefixed): `varuint(syncType) + syncPayload`
 *       syncType 0 = SyncStep1 (varuint8Array state vector)
 *       syncType 1 = SyncStep2 (varuint8Array update)
 *       syncType 2 = Update    (varuint8Array update)
 *
 *   outerType 1 (messageAwareness):
 *     payload = varuint8Array(awarenessUpdateBytes)
 *
 *   outerType 3 (messageQueryAwareness):
 *     payload = empty; the server replies with a messageAwareness frame.
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_BOARD_LOAD_FAILED = 4500;
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; rest: Uint8Array }
  | { kind: 'awareness'; awarenessBytes: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode an incoming WebSocket frame. For `sync`, `rest` is the byte slice
 * after the outer type byte (the raw y-protocols sync message), ready to be
 * handed to `readSyncMessage` with a fresh decoder.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }

  try {
    const bytes = new Uint8Array(data);
    if (bytes.length === 0) {
      return { kind: 'invalid', reason: 'empty frame' };
    }
    const dec = decoder.createDecoder(bytes);
    const type = decoder.readVarInt(dec);
    const pos = (dec as unknown as { pos: number }).pos;

    if (type === MESSAGE_SYNC) {
      return { kind: 'sync', rest: bytes.slice(pos) };
    }
    if (type === MESSAGE_AWARENESS) {
      return { kind: 'awareness', awarenessBytes: decoder.readVarUint8Array(dec) };
    }
    if (type === MESSAGE_QUERY_AWARENESS) {
      return { kind: 'query-awareness' };
    }
    return { kind: 'invalid', reason: `unknown type ${type}` };
  } catch (e) {
    return { kind: 'invalid', reason: `decode error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Prepend the messageSync outer type to a raw y-protocols sync message. */
export function encodeSyncFrame(rawSyncBytes: Uint8Array): Uint8Array {
  const header = encoder.createEncoder();
  encoder.writeVarInt(header, MESSAGE_SYNC);
  const headerBytes = encoder.toUint8Array(header);
  const out = new Uint8Array(headerBytes.length + rawSyncBytes.length);
  out.set(headerBytes, 0);
  out.set(rawSyncBytes, headerBytes.length);
  return out;
}

/** Build a messageAwareness frame: `varuint(1) + varuint8Array(bytes)`. */
export function encodeAwarenessFrame(awarenessBytes: Uint8Array): Uint8Array {
  const frame = encoder.createEncoder();
  encoder.writeVarInt(frame, MESSAGE_AWARENESS);
  encoder.writeVarUint8Array(frame, awarenessBytes);
  return encoder.toUint8Array(frame);
}
