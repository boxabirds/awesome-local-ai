// y-websocket message framing shared by the BoardRoom and tests.
//
// Wire format of one WebSocket binary message:
//   varUint(messageType) payload
// where messageType is one of MESSAGE_SYNC | MESSAGE_AWARENESS | MESSAGE_QUERY_AWARENESS.
// The payload of a sync message is a y-protocols/sync message; the payload of an
// awareness message is a length-prefixed awareness update (lib0 varUint8Array).

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

export const CLOSE_UNSUPPORTED_DATA = 1003;
export const CLOSE_BOARD_LOAD_FAILED = 4500;
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) return { kind: 'invalid', reason: 'empty message' };
  try {
    const dec = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(dec);
    switch (type) {
      case MESSAGE_SYNC:
        return { kind: 'sync', payload: bytes.subarray(dec.pos) };
      case MESSAGE_AWARENESS: {
        // Validate the length-prefixed awareness update is fully present.
        const update = decoding.readVarUint8Array(dec);
        return { kind: 'awareness', payload: update };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch {
    return { kind: 'invalid', reason: 'truncated message' };
  }
}

/** SyncStep1 from a doc's current state vector. */
export function syncStep1Message(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  return encoding.toUint8Array(enc);
}

/** A Yjs update inside a sync message (what the server broadcasts). */
export function updateMessage(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeUpdate(enc, update);
  return encoding.toUint8Array(enc);
}

/** SyncStep2 carrying everything `doc` lacks for `remoteStateVector`. */
export function syncStep2Message(doc: Y.Doc, remoteStateVector: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(enc, doc, remoteStateVector);
  return encoding.toUint8Array(enc);
}

/** Query-awareness message (used by test clients). */
export function queryAwarenessMessage(): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(enc);
}

/** Awareness message wrapping encoded awareness update bytes. */
export function awarenessMessage(updateBytes: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, updateBytes);
  return encoding.toUint8Array(enc);
}
