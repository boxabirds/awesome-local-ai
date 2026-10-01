// src/shared/protocol.ts
// y-websocket message framing shared by server, client, and tests.

import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'string frame' };
  }

  try {
    const uint8 = new Uint8Array(data);
    const decoder = decoding.createDecoder(uint8);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        const len = decoding.readVarUint(decoder);
        const payload = decoding.readUint8Array(decoder, len);
        return { kind: 'sync', payload };
      }
      case MESSAGE_AWARENESS: {
        const len = decoding.readVarUint(decoder);
        const payload = decoding.readUint8Array(decoder, len);
        return { kind: 'awareness', payload };
      }
      case MESSAGE_QUERY_AWARENESS: {
        return { kind: 'query-awareness' };
      }
      default: {
        return { kind: 'invalid', reason: `unknown type ${messageType}` };
      }
    }
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : 'decode error' };
  }
}

export function encodeMessage(type: number, payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  encoding.writeVarUint(encoder, payload.length);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}
