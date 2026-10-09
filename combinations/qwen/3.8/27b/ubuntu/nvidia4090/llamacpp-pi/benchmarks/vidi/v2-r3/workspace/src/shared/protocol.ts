/**
 * y-websocket wire framing (shared by the room, the tests and the client
 * provider). A frame is one binary message:
 *
 * - MESSAGE_SYNC (0):            varUint(0) followed by one or more raw
 *                                y-protocols sync messages (NOT length-wrapped)
 * - MESSAGE_AWARENESS (1):       varUint(1) + varUint8Array awareness update
 * - MESSAGE_QUERY_AWARENESS (3): varUint(3), no payload
 *
 * This mirrors the y-websocket client's own encoding byte-for-byte, so a stock
 * WebsocketProvider can talk to the room unmodified. Text frames (string data)
 * are not supported: they decode as invalid and the room closes the socket
 * with CLOSE_UNSUPPORTED_DATA.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

/**
 * Room close codes (story 4). 4500 sits in y-websocket's 4500-4599
 * "try again later" range, so the stock WebsocketProvider keeps retrying
 * on its normal backoff — which is exactly what a LoadFailed room needs.
 * 1011 (Internal Error) signals a storage failure: the board is readable,
 * and the client's unsaved changes are re-sent on reconnection.
 */
export const CLOSE_BOARD_LOAD_FAILED = 4500;
export const CLOSE_STORAGE_FAILURE = 1011;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness'; payload: Uint8Array }
  | { kind: 'invalid'; reason: string };

export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frame' };
  }
  try {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        // Raw sync messages until the end of the buffer.
        const payload = decoding.readTailAsUint8Array(decoder);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness', payload: new Uint8Array(0) };
      default:
        return { kind: 'invalid', reason: `unknown type ${type}` };
    }
  } catch (err) {
    return { kind: 'invalid', reason: String(err) };
  }
}

/**
 * Builds a y-websocket frame. `payload` for MESSAGE_SYNC is a raw encoded
 * sync message (or concatenated messages); for other types it is wrapped as a
 * varUint8Array.
 */
export function encodeFrame(messageType: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageType);
  if (messageType === MESSAGE_SYNC) {
    encoding.writeUint8Array(encoder, payload);
  } else {
    encoding.writeVarUint8Array(encoder, payload);
  }
  return encoding.toUint8Array(encoder);
}
