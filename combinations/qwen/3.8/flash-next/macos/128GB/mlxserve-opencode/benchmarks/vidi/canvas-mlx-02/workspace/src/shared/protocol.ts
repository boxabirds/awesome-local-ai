// y-websocket wire framing shared by the BoardRoom Durable Object and the
// integration-test clients (both speak the identical framing as the browser
// WebsocketProvider). A message is `[varuint type][message body...]`.
//
//   type 0 sync            -> body is a y-protocols sync message (inline)
//   type 1 awareness       -> body is a length-prefixed awareness update
//   type 3 query-awareness -> body empty
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

// Close code sent for a message the room cannot use (text frame, undecodable
// bytes, unknown type, or an update Yjs rejected). 1003 = Unsupported Data.
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

// Decode one WebSocket frame into a typed result. Never throws: any decode
// error (string frame, truncated bytes, unknown type) becomes `{ kind:
// 'invalid' }` so the caller can decide how to react (close that socket only).
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frame' };
  }
  let decoder: decoding.Decoder;
  try {
    decoder = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
        return { kind: 'sync', payload: decoding.readTailAsUint8Array(decoder) };
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', payload: decoding.readVarUint8Array(decoder) };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (err) {
    return { kind: 'invalid', reason: `undecodable: ${(err as Error)?.message ?? 'range error'}` };
  }
}

// Frame a y-protocols sync message (already produced by writeSyncStep1/2 or
// writeUpdate) into a wire message.
export function encodeSyncMessage(syncBody: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeUint8Array(enc, syncBody);
  return encoding.toUint8Array(enc);
}
