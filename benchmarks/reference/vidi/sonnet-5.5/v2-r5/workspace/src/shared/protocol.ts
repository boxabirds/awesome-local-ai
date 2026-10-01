import * as decoding from 'lib0/decoding';

// y-websocket framing
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

/** `payload` is the whole frame (type prefix included): sync frames are fed to readSyncMessage, awareness frames relayed verbatim. */
export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') return { kind: 'invalid', reason: 'text frame' };
  try {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC:
        if (!decoding.hasContent(decoder)) return { kind: 'invalid', reason: 'empty sync message' };
        return { kind: 'sync', payload: bytes };
      case MESSAGE_AWARENESS:
        if (!decoding.hasContent(decoder)) return { kind: 'invalid', reason: 'empty awareness message' };
        return { kind: 'awareness', payload: bytes };
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        return { kind: 'invalid', reason: `unknown message type ${type}` };
    }
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'undecodable' };
  }
}
