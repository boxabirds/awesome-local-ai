// y-websocket message framing shared by the BoardRoom Durable Object, the
// integration tests and the client provider. Frames on the socket are a
// lib0 varuint message type followed by the message content, exactly as
// y-websocket sends them.

import * as decoding from 'lib0/decoding';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const CLOSE_UNSUPPORTED_DATA = 1003;

// y-protocols/sync message ids (inlined to keep this module dependency-light).
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

export type Decoded =
  | { kind: 'sync'; payload: Uint8Array }
  | { kind: 'awareness'; payload: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'invalid'; reason: string };

// lib0's readVarUint never fails on truncated input (it reads past-the-end
// bytes as 0), so every read is bounds-checked and the decoder position is
// compared against the buffer length to detect cut-off varuints.
function readVarUintChecked(dec: decoding.Decoder): number {
  if (dec.pos >= dec.arr.length) throw new Error('truncated frame: varuint expected');
  const value = decoding.readVarUint(dec);
  if (dec.pos > dec.arr.length) throw new Error('truncated frame: varuint runs past end');
  return value;
}

function expectDataLength(dec: decoding.Decoder): void {
  const length = readVarUintChecked(dec);
  if (dec.arr.length - dec.pos < length) throw new Error('truncated frame: payload shorter than declared');
}

export function decodeMessage(data: ArrayBuffer | string): Decoded {
  if (typeof data === 'string') {
    return { kind: 'invalid', reason: 'text frames are not supported' };
  }
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0) {
    return { kind: 'invalid', reason: 'empty frame' };
  }
  try {
    const dec = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(dec);
    switch (type) {
      case MESSAGE_SYNC: {
        const syncId = readVarUintChecked(dec);
        if (syncId !== SYNC_STEP1 && syncId !== SYNC_STEP2 && syncId !== SYNC_UPDATE) {
          throw new Error(`unknown sync protocol id ${syncId}`);
        }
        expectDataLength(dec);
        return { kind: 'sync', payload: bytes.subarray(1) };
      }
      case MESSAGE_AWARENESS: {
        expectDataLength(dec);
        return { kind: 'awareness', payload: bytes.subarray(1) };
      }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' };
      default:
        throw new Error(`unknown message type ${type}`);
    }
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
}
