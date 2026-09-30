// y-websocket message framing, shared by the BoardRoom and its tests.
import * as decoding from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for frames the room cannot understand. */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/**
 * Splits a frame into its message type and payload. `sync` payloads are the
 * y-protocols sync message (type + data); `awareness` payloads are the
 * varUint8Array body. Anything malformed is `invalid`, never a throw.
 */
export function decodeMessage(data: ArrayBuffer | ArrayBufferView | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes =
    data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.length === 0) return { kind: 'invalid', reason: 'empty frame' };
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const payload = bytes.subarray(decoder.pos);
        const inner = decoding.createDecoder(payload);
        decoding.readVarUint(inner); // sync step type
        decoding.readVarUint8Array(inner); // state vector or update
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const payload = decoding.readVarUint8Array(decoder);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : 'undecodable frame' };
  }
}
