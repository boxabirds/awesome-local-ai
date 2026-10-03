/**
 * y-websocket framing shared by the room, the tests and (indirectly) the
 * browser provider.
 *
 * A binary WebSocket frame is: varuint(message type) + payload.
 */

import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

/** Message type: Yjs sync protocol. */
export const MESSAGE_SYNC = 0;
/** Message type: awareness. */
export const MESSAGE_AWARENESS = 1;
/** Message type: query awareness (ignored by the room in this story). */
export const MESSAGE_QUERY_AWARENESS = 3;
/** Close code for unsupported/malformed data. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Result of decoding a WebSocket frame.
 * `payload` is the frame bytes with the leading message-type varuint removed.
 */
export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Decode a WebSocket frame into a typed result.
 * String frames, undecodable bytes, unknown message types and truncated
 * sync submessages all yield `{ kind: 'invalid' }`.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }
  const buf = new Uint8Array(data);
  if (buf.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty frame' };
  }
  try {
    const decoder = decoding.createDecoder(buf);
    const type = decoding.readVarUint(decoder);
    const payload = decoding.readTailAsUint8Array(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // Sync payload is the raw submessage bytes (no outer length prefix):
        // [submessage type varuint][submessage data]. Validate that a known
        // submessage type is present so truncated frames are caught here.
        const subDecoder = decoding.createDecoder(payload);
        const sub = decoding.peekVarUint(subDecoder);
        if (sub > 2) {
          return { kind: 'invalid', reason: `unknown sync submessage ${sub}` };
        }
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        // Awareness payload is a length-prefixed varuint8Array blob.
        const blob = decoding.createDecoder(payload);
        const awarenessBytes = decoding.readVarUint8Array(blob);
        return { kind: 'awareness', payload: awarenessBytes };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: `undecodable frame: ${String(e)}` };
  }
}

/**
 * Frame a payload with a leading message-type varuint, ready to send.
 */
export function encodeFrame(type: number, payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  encoding.writeVarUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}
