import * as decoding from 'lib0/decoding';
/**
 * y-websocket message framing, shared by the BoardRoom Durable Object and the tests.
 *
 *   [messageType: varUint, ...]
 *   MESSAGE_SYNC:            [0, syncType: varUint (0 step1 | 1 step2 | 2 update), payload: varUint8Array]
 *   MESSAGE_AWARENESS:       [1, awarenessUpdate: varUint8Array]
 *   MESSAGE_QUERY_AWARENESS: [3]
 */

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
/** WebSocket close code for frames the room cannot use (RFC 6455 "unsupported data"). */
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

/**
 * Checks a WebSocket frame's y-websocket framing without applying it. Never throws: string
 * frames, unknown types, unknown sync sub-types and truncated bytes all return `invalid`.
 * For `sync` the payload is the sync message (starting at its sub-type), ready for
 * `y-protocols/sync`; for `awareness` it is the inner awareness update.
 */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  const bytes = new Uint8Array(data);
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const start = decoder.pos;
        const syncType = decoding.readVarUint(decoder);
        if (syncType !== SYNC_STEP_1 && syncType !== SYNC_STEP_2 && syncType !== SYNC_UPDATE) {
          return { kind: 'invalid', reason: `unknown sync type ${syncType}` };
        }
        decoding.readVarUint8Array(decoder);
        if (decoding.hasContent(decoder)) return { kind: 'invalid', reason: 'trailing bytes' };
        return { kind: 'sync', payload: bytes.subarray(start) };
      }
      case MESSAGE_AWARENESS: {
        const payload = decoding.readVarUint8Array(decoder);
        if (decoding.hasContent(decoder)) return { kind: 'invalid', reason: 'trailing bytes' };
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : 'undecodable' };
  }
}
